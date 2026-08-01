// INGEST OPINII WZORCOWYCH → korpus stylu.
//
// Czyta opinie biegłego (.docx / .pdf), dzieli na rozdziały, SZKIELETYZUJE (usuwa nazwiska,
// liczby, daty, sygnatury) i zapisuje do tabeli `wzorce`. Surowa treść nigdy nie trafia
// do bazy — do bazy idzie wyłącznie szkielet.
//
// Użycie:
//   npx tsx scripts/fullrun/ingest_wzorce.ts --dry            # tylko raport, bez zapisu
//   npx tsx scripts/fullrun/ingest_wzorce.ts --zapisz         # zapis do `wzorce`
//   npx tsx scripts/fullrun/ingest_wzorce.ts --dir "<katalog>" # własny katalog z opiniami
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";

const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import { pdfLines } from "@/lib/intake/pdf";
import { czyGeneratAplikacji, podzielNaRozdzialy, resztkoweNazwy, rodzajZTytulu, rozdzialyZDocx, szkieletyzuj, wykryjWycieki } from "@/lib/opinion/wzorce";

const args = process.argv.slice(2);
const ZAPISZ = args.includes("--zapisz");
const dirArg = args.indexOf("--dir");
const KATALOGI = dirArg >= 0 ? [args[dirArg + 1]] : [join(process.env.HOME ?? "", "Downloads")];
// Lista dodatkowych nazw do wycięcia (jedna na wiersz) — dla spraw, których nie ma
// w bazie, a więc bez rostera: to jedyny sposób podania nazw stron postępowania.
const nazwyArg = args.indexOf("--nazwy");
const PLIK_NAZW = nazwyArg >= 0 ? args[nazwyArg + 1] : "";
// Świadome dopuszczenie zapisu mimo nazw resztkowych (gdy przejrzane i nieszkodliwe).
const MIMO_NAZW = args.includes("--mimo-nazw");

/** Surowy word/document.xml — źródło stylów nagłówków (autorytatywna struktura). */
async function docxXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return (await zip.file("word/document.xml")?.async("string")) ?? "";
}

/** Tekst z .docx — zdjęcie znaczników z zachowaniem akapitów. */
function docxText(xml: string): string {
  if (!xml) return "";
  return xml
    .replace(/<w:p[ >]/g, "\n<w:p ") // akapit → nowa linia
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Kandydaci: pliki wyglądające na PEŁNĄ opinię biegłego (nie załączniki, nie generaty). */
function znajdzOpinie(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 5 || !existsSync(d)) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p, depth + 1);
        continue;
      }
      const ext = extname(e).toLowerCase();
      if (ext !== ".docx" && ext !== ".pdf") continue;
      const n = e.toLowerCase();
      // opinia/wnioski, ale NIE moje generaty ani załączniki
      if (!/opinia|opinie|wnioski|hub\.tech/i.test(n)) continue;
      if (/projekt|_v\d|2026-07-30|podglad|robocza|zal_|graf|wykaz|spoofing/i.test(n)) continue;
      if (st.size < 20_000) continue; // fragmenty/skróty
      out.push(p);
    }
  };
  for (const d of dirs) walk(d, 0);
  return [...new Set(out)];
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // Nazwy własne ze WSZYSTKICH rosterów — najpewniejsza warstwa szkieletyzacji.
  const { data: cases } = await sb.from("cases").select("name,group_roster");
  const nazwy: string[] = [];
  for (const c of cases ?? []) {
    const ents = ((c.group_roster as { entities?: { name: string }[] } | null)?.entities ?? []).map((e) => e.name);
    nazwy.push(...ents, String(c.name));
  }
  // Dodatkowe nazwy z pliku — niezbędne dla opinii ze spraw spoza bazy.
  let zPliku: string[] = [];
  if (PLIK_NAZW) {
    try {
      zPliku = readFileSync(PLIK_NAZW, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      console.log(`Nazwy z pliku ${PLIK_NAZW}: ${zPliku.length}`);
    } catch {
      console.log(`⚠ nie udało się odczytać ${PLIK_NAZW} — pomijam`);
    }
  }
  const nazwyWlasne = [...new Set([...nazwy, ...zPliku].filter(Boolean))];
  console.log(`Nazwy własne do usunięcia: ${nazwyWlasne.length}`);

  const pliki = znajdzOpinie(KATALOGI);
  console.log(`Znalezione opinie: ${pliki.length}\n`);

  let wszystkieRozdzialy = 0;
  let zapisane = 0;
  const wycieki: string[] = [];
  const resztki: string[] = [];

  for (const p of pliki) {
    const nazwa = basename(p);
    let tekst = "";
    let xml = "";
    try {
      const buf = readFileSync(p);
      if (extname(p).toLowerCase() === ".docx") {
        xml = await docxXml(buf);
        tekst = docxText(xml);
      } else {
        tekst = await pdfLines(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      }
    } catch (e) {
      console.log(`  ✗ ${nazwa}: nie udało się odczytać (${(e as Error).message})`);
      continue;
    }
    // BRAMKA PROWENIENCJI: opinia wygenerowana przez tę aplikację nie może uczyć
    // jej własnego stylu — to sprzężenie zwrotne, nie nauka od biegłego.
    const prow = czyGeneratAplikacji(tekst);
    if (prow.generat) {
      console.log(`  ⛔ ${nazwa}: GENERAT APLIKACJI (${prow.odciski.slice(0, 2).join(", ")}) — pominięty`);
      continue;
    }

    // STYLE NAGŁÓWKÓW przed regexem: dla .docx to autorytatywna struktura dokumentu.
    // Rozdzielacz tekstowy widział w opinii HubTech 7 rozdziałów zamiast 14 — gubił
    // cały poziom 2, czyli wszystkie rozdziały technik. Regex zostaje dla PDF-ów
    // i dla plików bez stylów (P24 nie ma ich wcale).
    const zeStylow = xml ? rozdzialyZDocx(xml) : [];
    const rozdzialy = zeStylow.length ? zeStylow : podzielNaRozdzialy(tekst);
    const skad = zeStylow.length ? "style nagłówków" : "wzorce tekstowe";
    if (!rozdzialy.length) {
      console.log(`  ○ ${nazwa}: ${tekst.length} zn., 0 rozdziałów (brak rozpoznanych nagłówków)`);
      continue;
    }
    console.log(`  ✓ ${nazwa}: ${tekst.length} zn. → ${rozdzialy.length} rozdziałów (${skad})`);
    wszystkieRozdzialy += rozdzialy.length;

    for (const r of rozdzialy) {
      const rodzaj = rodzajZTytulu(r.tytul);
      // Spisy tabel/załączników to listy nazw plików — bezużyteczne jako wzorzec stylu
      // i główne źródło wycieków (nazwiska w nazwach plików). Świadomie pomijamy.
      if (rodzaj === "inne") {
        console.log(`      ${r.no.padEnd(6)} ${"(pominięty)".padEnd(13)} ${String(r.tresc.length).padStart(6)} zn.  spis/załączniki — nie jest wzorcem stylu`);
        continue;
      }
      const szkielet = szkieletyzuj(r.tresc, nazwyWlasne);
      const wyc = wykryjWycieki(szkielet, nazwyWlasne);
      // Nazwy własne, które PRZETRWAŁY — jedyna kontrola dla spraw bez rostera.
      // `wykryjWycieki` sprawdza tylko nazwy znane z bazy, więc bez tego raport
      // pokazywałby „szczelny ✓" także wtedy, gdy nazwisko z obcej sprawy zostało.
      const reszt = resztkoweNazwy(szkielet).filter((x) => x.ile >= 2);
      if (wyc.length) wycieki.push(`${nazwa} / ${r.no}: ${wyc.slice(0, 5).join(", ")}`);
      if (reszt.length) resztki.push(`${nazwa} / ${r.no}: ${reszt.slice(0, 8).map((x) => `${x.nazwa}(${x.ile})`).join(", ")}`);
      const blokada = wyc.length > 0 || (reszt.length > 0 && !MIMO_NAZW);
      console.log(
        `      ${r.no.padEnd(6)} ${rodzaj.padEnd(13)} ${String(r.tresc.length).padStart(6)} zn.` +
          `  ${wyc.length ? `⚠ WYCIEKI: ${wyc.length}` : reszt.length ? `⚠ NAZWY: ${reszt.length}` : "szczelny ✓"}` +
          `  ${r.tytul.slice(0, 42)}`,
      );
      if (reszt.length) console.log(`             do przejrzenia: ${reszt.slice(0, 8).map((x) => `${x.nazwa}(${x.ile})`).join(", ")}`);
      if (ZAPISZ && !blokada) {
        const { error } = await sb.from("wzorce").upsert(
          {
            autor: "KM",
            sprawa: nazwa.replace(/\.(docx|pdf)$/i, ""),
            plik: nazwa,
            rozdzial_no: r.no,
            rodzaj,
            tytul: r.tytul,
            szkielet,
            znakow: r.tresc.length,
          },
          { onConflict: "plik,rozdzial_no,rodzaj" },
        );
        if (!error) zapisane++;
        else console.log(`        błąd zapisu: ${error.message}`);
      }
    }
  }

  console.log(`\n═══ PODSUMOWANIE ═══`);
  console.log(`  plików: ${pliki.length}, rozdziałów: ${wszystkieRozdzialy}`);
  console.log(`  rozdziałów z WYCIEKAMI (nie zapisywane): ${wycieki.length}`);
  for (const w of wycieki.slice(0, 10)) console.log(`     ⚠ ${w}`);
  console.log(`  rozdziałów z NAZWAMI DO PRZEJRZENIA: ${resztki.length}${MIMO_NAZW ? " (zapis wymuszony --mimo-nazw)" : " (zapis zablokowany)"}`);
  for (const w of resztki.slice(0, 15)) console.log(`     ⚠ ${w}`);
  if (resztki.length && !MIMO_NAZW) {
    console.log(`\n  → Przejrzyj powyższe nazwy. Te, które są STRONAMI postępowania, wpisz`);
    console.log(`    (po jednej w wierszu) do pliku i uruchom ponownie z:  --nazwy <plik.txt>`);
    console.log(`    Jeśli to terminy branżowe, a nie nazwy stron — dodaj --mimo-nazw.`);
  }
  if (ZAPISZ) console.log(`  ZAPISANO do wzorce: ${zapisane}`);
  else console.log(`  tryb --dry (bez zapisu). Uruchom z --zapisz, gdy raport wygląda dobrze.`);
}

main().catch((e) => {
  console.error("BŁĄD:", e);
  process.exit(1);
});
