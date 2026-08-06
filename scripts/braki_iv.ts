// Przeliczenie rejestru braków rozdziału IV → subanaliza `braki_iv`.
//   npx tsx scripts/braki_iv.ts <fragment nazwy sprawy>
// Uruchamiać po KAŻDYM ingeście materiału i po każdym przeliczeniu modułów —
// rejestr jest wyliczany ze stanu sprawy, więc pozycje znikają same, gdy materiał
// trafi do akt (patrz komentarz w lib/opinion/braki-iv.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { tabelaBrakow, zbudujBrakiIV } from "@/lib/opinion/braki-iv";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: cases } = await sb.from("cases").select("id,name,typ").ilike("name", `%${process.argv[2]}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "manipulacja_gpw") throw new Error("rejestr braków IV dotyczy spraw o manipulację GPW");

  const { data: subs } = await sb.from("subanalyses").select("kind,data").eq("case_id", c.id);
  const { data: docs } = await sb.from("documents").select("doc_type").eq("case_id", c.id).limit(3000);
  const { data: metrics } = await sb.from("metrics").select("key").eq("case_id", c.id).limit(20000);

  const licznikTypow: Record<string, number> = {};
  for (const d of docs ?? []) licznikTypow[d.doc_type as string] = (licznikTypow[d.doc_type as string] ?? 0) + 1;

  const { braki, pokrycie } = zbudujBrakiIV({
    subanalizy: new Map((subs ?? []).map((s) => [s.kind as string, (s.data ?? null) as Record<string, unknown> | null])),
    licznikTypow,
    klucze: new Set((metrics ?? []).map((m) => m.key as string)),
    instrumenty: (subs ?? []).filter((s) => (s.kind as string).startsWith("trem_")).map((s) => (s.kind as string).replace("trem_", "").toUpperCase()),
  });

  const table = tabelaBrakow(braki);
  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: c.id,
      kind: "braki_iv",
      chapter_no: "IV",
      title: "Materiały brakujące do rozdziału IV (rejestr)",
      status: "szkic",
      body_md:
        braki.length
          ? `Do pełnego rozdziału IV brakuje ${braki.length} pozycji materiału; podrozdziałów bez braków: ${pokrycie.gotowe} z ${pokrycie.wszystkie}.`
          : "Rozdział IV ma komplet materiału — rejestr braków jest pusty.",
      data: {
        table,
        braki,
        pokrycie,
        findings: [
          braki.length
            ? `Rejestr braków rozdziału IV: ${braki.length} pozycji; podrozdziałów kompletnych ${pokrycie.gotowe}/${pokrycie.wszystkie}.`
            : `Rozdział IV: komplet materiału we wszystkich ${pokrycie.wszystkie} podrozdziałach.`,
        ],
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) throw new Error(`zapis: ${error.message}`);

  console.log(`✓ braki_iv: ${braki.length} pozycji; podrozdziały kompletne ${pokrycie.gotowe}/${pokrycie.wszystkie}\n`);
  for (const b of braki) console.log(`  [${b.podrozdzial}] ${b.czego.slice(0, 92)}\n        → ${b.doCzego.slice(0, 88)}\n        ⇐ ${b.kto}`);
}
main().catch((e) => {
  console.error("BŁĄD:", e.message);
  process.exit(1);
});
