// Wgranie plików do sprawy z linii poleceń — ta sama ścieżka co interfejs.
//
//   npx tsx scripts/wgraj_akta.ts --sprawa MBR --dir "<katalog>" [--tylko "a.pdf,b.pdf"] [--zapisz]
//
// Powstało, bo pliki po OCR trzeba wgrać obok oryginałów, a przeklikiwanie
// dziewięciu plików w oknie wyboru jest podatne na pomyłkę. Skrypt używa TYCH SAMYCH
// reguł co aplikacja: `storageKey` do klucza w magazynie i `classify` z typem sprawy —
// inaczej plik wgrany z konsoli miałby inny typ niż ten sam plik wgrany z przeglądarki.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { createClient } from "@supabase/supabase-js";

import { classify } from "@/lib/intake/classify";
import { storageKey } from "@/lib/upload";

const args = process.argv.slice(2);
const val = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : "";
};
const SPRAWA = val("--sprawa");
const DIR = val("--dir");
const TYLKO = val("--tylko").split(",").map((s) => s.trim()).filter(Boolean);
const ZAPISZ = args.includes("--zapisz");

if (!SPRAWA || !DIR) {
  console.error("Użycie: --sprawa <nazwa> --dir <katalog> [--tylko a.pdf,b.pdf] [--zapisz]");
  process.exit(1);
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: sprawy } = await sb.from("cases").select("id,name,typ").eq("name", SPRAWA);
  if (!sprawy?.length) {
    console.error(`✗ nie znaleziono sprawy o nazwie ${SPRAWA}`);
    process.exit(1);
  }
  const sprawa = sprawy[0];
  console.log(`Sprawa: ${sprawa.name} (${sprawa.typ})`);

  const { data: istniejace } = await sb.from("documents").select("rel_path,storage_path").eq("case_id", sprawa.id);
  const wMagazynie = new Set((istniejace ?? []).filter((d) => d.storage_path).map((d) => d.rel_path));

  // Nazwy plików porównujemy po NFC — macOS trzyma je w NFD i „uchwała" z dysku
  // nie równa się „uchwała" z listy podanej w wierszu poleceń.
  const nfc = (s: string) => s.normalize("NFC");
  const chce = new Set(TYLKO.map(nfc));

  const pliki = readdirSync(DIR)
    .filter((f) => statSync(join(DIR, f)).isFile() && !f.startsWith("."))
    .filter((f) => !chce.size || chce.has(nfc(f)));

  if (chce.size) {
    const brak = [...chce].filter((c) => !pliki.some((p) => nfc(p) === c));
    for (const b of brak) console.log(`  ⚠ nie ma w katalogu: ${b}`);
  }

  let wgrane = 0;
  let pominiete = 0;
  for (const nazwa of pliki.sort()) {
    const sciezka = join(DIR, nazwa);
    const rel = basename(nazwa);
    if (wMagazynie.has(rel)) {
      console.log(`  ⊘ ${rel} — już jest w sprawie`);
      pominiete++;
      continue;
    }
    const bytes = readFileSync(sciezka);
    const { code, source, provenance } = classify(rel, sprawa.typ);
    const sp = storageKey(`${sprawa.id}/${rel}`);
    console.log(`  ${ZAPISZ ? "→" : "·"} ${code.padEnd(22)} ${(bytes.length / 1e6).toFixed(1)} MB  ${rel}`);
    if (!ZAPISZ) continue;

    const { error: eUp } = await sb.storage
      .from("case-files")
      .upload(sp, bytes, { contentType: "application/pdf", upsert: true });
    if (eUp) {
      console.log(`      ✗ magazyn: ${eUp.message}`);
      continue;
    }
    const { error: eDb } = await sb.from("documents").insert({
      case_id: sprawa.id,
      rel_path: rel,
      size_bytes: bytes.length,
      doc_type: code,
      source,
      provenance,
      storage_path: sp,
      // Plik po OCR ma warstwę tekstową z definicji — oznaczamy od razu, żeby raport
      // kompletności nie musiał czekać na osobny przebieg `--oznacz`.
      warstwa_tekstu: rel.endsWith(".ocr.pdf") ? "ocr" : undefined,
    });
    if (eDb) console.log(`      ✗ baza: ${eDb.message}`);
    else wgrane++;
  }

  console.log(
    ZAPISZ
      ? `\n✓ wgrano ${wgrane}, pominięto ${pominiete}`
      : `\n  tryb próbny — ${pliki.length} plików; uruchom z --zapisz`,
  );
}

main().catch((e) => {
  console.error("BŁĄD:", e);
  process.exit(1);
});
