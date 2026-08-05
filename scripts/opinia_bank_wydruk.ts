// Montaż i wydruk opinii bankowej (PDF + DOCX) z wiersza poleceń.
//   npx tsx scripts/opinia_bank_wydruk.ts <fragment nazwy sprawy> [--final]
//
// Bez `--final` dokument nosi „(projekt roboczy)" — status rozdziałów pozostaje
// `szkic`, bo zatwierdzenie jest AKTEM BIEGŁEGO, nie skryptu (bramka-finalna.ts).
// Wynik: ~/Desktop + Storage `<sprawa>/OUTPUT/…` z wpisem w documents (wyjście),
// wersjonowany po liczbie wcześniejszych wydruków — jak s5_pdf.ts w dziedzinie GPW.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { Packer } from "docx";
import { createClient } from "@supabase/supabase-js";
import { buildOpinionDla } from "@/lib/opinion/build-router";
import { renderOpinionDocx } from "@/lib/opinion/docx";
import { renderOpinionPdf } from "@/lib/opinion/pdf";
import { fetchAllMetrics } from "@/lib/metrics-fetch";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const fraza = process.argv[2];
  if (!fraza) throw new Error("użycie: npx tsx scripts/opinia_bank_wydruk.ts <sprawa> [--final]");
  const final = process.argv.includes("--final");

  const { data: cases } = await sb
    .from("cases")
    .select("id,name,signature,typ,tryb,rola,organ,data_powolania,group_roster")
    .ilike("name", `%${fraza}%`);
  if (!cases?.length) throw new Error("nie znaleziono sprawy");
  const c = cases[0];
  if (c.typ !== "ryzyko_bankowe") throw new Error("ten wydruk jest dla spraw o ryzyko bankowe");

  const metrics = await fetchAllMetrics(sb, c.id);
  const { data: documents } = await sb.from("documents").select("rel_path,provenance").eq("case_id", c.id);
  const { data: subanalyses } = await sb
    .from("subanalyses")
    .select("kind,chapter_no,title,status,body_md,data")
    .eq("case_id", c.id);

  const op = buildOpinionDla(c as never, (metrics ?? []) as never, (documents ?? []) as never, (subanalyses ?? []) as never);
  // Proza rozdziału jest w `paras` (akapity), nie w `bodyMd` — licznik po złym
  // polu pokazywał „z prozą: 0" przy 110 stronach PDF i wyglądał jak pusta opinia.
  const zProza = op.chapters.filter((ch) => (ch.paras?.length ?? 0) > 0).length;
  console.log(`Rozdziały: ${op.chapters.length}, z prozą: ${zProza}`);
  console.log(op.chapters.map((ch) => `${ch.no} ${ch.title.slice(0, 40)} (${ch.status})`).join("\n"));

  const stamp = new Date().toISOString().slice(0, 10);
  const skrot = c.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
  // Numer = NAJWYŻSZY istniejący + 1, nie liczność plików: po nadpisaniu v3 liczność
  // wynosiła 2 (v1, v3) i „kolejny" wydruk znów trafiał w v3, nadpisując poprzedni.
  const { data: prev } = await sb
    .from("documents").select("rel_path").eq("case_id", c.id).ilike("rel_path", `OUTPUT/Opinia_${skrot}_%.pdf`);
  const ver =
    Math.max(0, ...(prev ?? []).map((p) => Number(p.rel_path.match(/_v(\d+)\.pdf$/)?.[1] ?? 0))) + 1;

  const pdf = await renderOpinionPdf(op, { final });
  const strn = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const docx = await Packer.toBuffer(renderOpinionDocx(op, { final }));
  console.log(`PDF ~${strn} str. (${(pdf.length / 1e6).toFixed(1)} MB), DOCX ${(docx.length / 1e6).toFixed(1)} MB`);

  for (const [ext, buf, mime] of [
    ["pdf", pdf, "application/pdf"],
    ["docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ] as const) {
    const rel = `OUTPUT/Opinia_${skrot}_${stamp}_v${ver}.${ext}`;
    const local = join(process.env.HOME ?? "", "Desktop", rel.split("/").pop()!);
    writeFileSync(local, buf);
    const up = await sb.storage.from("case-files").upload(`${c.id}/${rel}`, buf, { contentType: mime, upsert: true });
    if (up.error) throw new Error(`upload ${ext}: ${up.error.message}`);
    const ins = await sb.from("documents").upsert(
      {
        case_id: c.id, rel_path: rel, storage_path: `${c.id}/${rel}`, size_bytes: buf.length,
        doc_type: "OPINIA_BIEGLEGO", source: "aplikacja — wydruk opinii", provenance: "wyjście",
      },
      { onConflict: "case_id,rel_path" },
    );
    if (ins.error) throw new Error(`documents ${ext}: ${ins.error.message}`);
    console.log(`ZAPISANO: ${local}  +  Storage ${rel}`);
  }
}
main().catch((e) => { console.error("BŁĄD:", e); process.exit(1); });
