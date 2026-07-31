// Weryfikacja taksonomii i wymogów kompletności dziedziny bankowej.
//
//   npx tsx scripts/check_taxonomy_bank.ts
//
// Nazwy plików są WBUDOWANE, nie czytane z dysku. Powód: golden testy silnika stały
// na pliku w ~/Downloads i przestały działać, gdy katalog został uporządkowany.
// Lista poniżej to rzeczywiste akta PO III Ds 84.2020 (84 pliki) w stanie z 08.2026.
import { classifyPath } from "@/lib/intake/classify";
import { buildCompleteness } from "@/lib/intake/completeness";

const AKTA_MBR = [
  "postanowienie o powołaniu biegłego.pdf",
  "Skany akt 84.2020/uchwała metodyka limitow.pdf",
  "Skany akt 84.2020/003_uchwała metodyka limitow.docx",
  "tabela limity k. 140.xlsx",
  "Skany akt 84.2020/protokoły KZAiP.pdf",
  "Skany akt 84.2020/uchwała kompetencje do podejmowania dec.pdf",
  "Skany akt 84.2020/audyt wew.pdf",
  "Skany akt 84.2020/014_audyt wew.docx",
  "Skany akt 84.2020/BION MBR.pdf",
  "Skany akt 84.2020/KNF postępowanie wyjaśniające.pdf",
  "Skany akt 84.2020/postępowanie-wyjaśniające.ocr.docx",
  "Skany akt 84.2020/zawiadomienie KNF.pdf",
  "RAPORTY KNF BANKI/Raport_banki_2007_8627.pdf",
  "RAPORTY KNF BANKI/Raport_banki_2008_10241.pdf",
  "KNB bankispoldzielcze 2006.pdf",
  "Informacja_o_sytuacji_bankow_09_9452.2008_9452.pdf",
  "załączniki/drive-download-20211013T074233Z-001/ZAŁĄCZNIK 5 - SF-GLITNIR-2008-2q.pdf",
  "załączniki/drive-download-20211013T074233Z-001/ZAŁĄCZNIK 6 - SF-GLITNIR-2007.pdf",
  "załączniki/drive-download-20211013T074233Z-001/ZAŁĄCZNIK 4 - 2008 enska FINANCIAL STABILITY.pdf",
  "załączniki/drive-download-20211013T074233Z-001/ZAŁĄCZNIK 1 - BIULETYN MONETARNY MB082_Innmatur.pdf",
  "CBI 2008 enska.pdf",
  "CDS default.xlsx",
  "^icex_d.csv",
  "załączniki/I Inflation outlook and monetary policy.xls",
  "Icelandic whispers shake faith in boom _ Financial Times.pdf",
  "załączniki/drive-download-20211013T074233Z-001/ZAŁĄCZNIK 2 - Islandia w tarapatach.pdf",
  "PRAWO BANKOWE 2008.pdf",
  "funkcjonowanie banków spółdzielczych 2008.pdf",
  "Uchwały KNB 2007/Uchwała nr 1 _2007 Komisji Nadzoru Bankowego z dnia 13 marca 2007 r..pdf",
  "rozporządzenie - rating.pdf",
  "DO DRUKU/2021.10.15 OPINIA PO III DS 84 2020.docx",
  "RACHUNEK I KARTA BIEGŁEGO PROKURATURA MBR.doc",
  "grafika/CDS Glitnir.jpg",
  "bibliografia/Bankowosc Podrecznik akademicki.cz1.pdf",
  "Domanska_Szaruga_Ryzyko_kredytowe_w_swietle NUK.pdf",
  "Gwizdała BASEL III.pdf",
];

// Oczekiwana klasyfikacja — pułapki, które realnie wystąpiły w tych aktach.
const OCZEKIWANE: [string, string][] = [
  ["Skany akt 84.2020/uchwała metodyka limitow.pdf", "METODYKA_LIMITOW"],
  ["Skany akt 84.2020/uchwała kompetencje do podejmowania dec.pdf", "UCHWALA_WEWNETRZNA"],
  // Raport sektorowy nadzoru, mimo skrótu KNB w nazwie — nie źródło prawa.
  ["KNB bankispoldzielcze 2006.pdf", "NADZOR_KNF"],
  // Uchwała KNB to JEST źródło prawa.
  ["Uchwały KNB 2007/Uchwała nr 1 _2007 Komisji Nadzoru Bankowego z dnia 13 marca 2007 r..pdf", "AKT_PRAWNY"],
  // Regulacja DOTYCZĄCA ratingów, nie komunikat agencji.
  ["rozporządzenie - rating.pdf", "AKT_PRAWNY"],
  ["załączniki/drive-download-20211013T074233Z-001/ZAŁĄCZNIK 5 - SF-GLITNIR-2008-2q.pdf", "SPRAWOZDANIE_BANK"],
  ["CBI 2008 enska.pdf", "RAPORT_BANK_CENTRALNY"],
  ["Icelandic whispers shake faith in boom _ Financial Times.pdf", "PRASA"],
  ["CDS default.xlsx", "DANE_RYNKOWE_SZEREG"],
  ["RACHUNEK I KARTA BIEGŁEGO PROKURATURA MBR.doc", "RACHUNEK_BIEGLEGO"],
  ["grafika/CDS Glitnir.jpg", "GRAFIKA"],
  // Podkreślenia zamiast spacji — dopasowanie po spłaszczeniu separatorów.
  ["Domanska_Szaruga_Ryzyko_kredytowe_w_swietle NUK.pdf", "LITERATURA"],
];

let bledy = 0;

console.log("── klasyfikacja: przypadki graniczne ──");
for (const [plik, oczekiwany] of OCZEKIWANE) {
  const got = classifyPath(plik, "ryzyko_bankowe");
  const ok = got === oczekiwany;
  if (!ok) bledy++;
  console.log(`  ${ok ? "✓" : "✗"} ${oczekiwany.padEnd(23)} ${ok ? "" : `(dostał ${got}) `}${plik.split("/").pop()?.slice(0, 52)}`);
}

console.log("\n── pokrycie akt ──");
const nieznane = AKTA_MBR.filter((p) => classifyPath(p, "ryzyko_bankowe") === "UNKNOWN");
console.log(`  rozpoznanych ${AKTA_MBR.length - nieznane.length}/${AKTA_MBR.length}`);
for (const p of nieznane) console.log(`     nierozpoznany: ${p}`);

console.log("\n── kompletność ──");
const docs = AKTA_MBR.map((p) => ({ rel_path: p, doc_type: classifyPath(p, "ryzyko_bankowe") }));
const r = buildCompleteness(docs, "ryzyko_bankowe");
console.log(`  wymogi ${r.wynik.spelnione}/${r.wynik.wszystkie} (${r.wynik.pct}%), braki krytyczne: ${r.braki_krytyczne.length}`);
const zleModuly = r.techniki.filter((t) => ["wash", "layering", "imo"].includes(t.kind));
if (zleModuly.length) {
  bledy++;
  console.log(`  ✗ raport bankowy wypisuje moduły GPW: ${zleModuly.map((t) => t.kind).join(", ")}`);
} else {
  console.log(`  ✓ moduły pochodzą z dziedziny bankowej (${r.techniki.length}), bez technik GPW`);
}

console.log("\n── nietykalność dziedziny GPW ──");
const gpw: [string, string][] = [
  ["HUBTECH/Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx", "DANE_UTP"],
  ["MLM/UTP_TREM_2022.xlsx", "DANE_TREM"],
  ["ZASTAL/Zestawienie zlecen (wszystkie instrumenty).xlsx", "DANE_BROKERSKIE"],
  ["HUBTECH/postanowienie.pdf", "POSTANOWIENIE"],
];
for (const [plik, oczekiwany] of gpw) {
  const got = classifyPath(plik); // bez typu → zestaw GPW
  const ok = got === oczekiwany;
  if (!ok) bledy++;
  console.log(`  ${ok ? "✓" : "✗"} ${oczekiwany.padEnd(18)} ${ok ? "" : `(dostał ${got}) `}${plik}`);
}

console.log(bledy ? `\n✗ BŁĘDÓW: ${bledy}` : "\n✓ wszystko zgodne");
process.exit(bledy ? 1 : 0);
