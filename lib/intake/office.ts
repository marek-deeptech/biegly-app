// Odczyt tekstu z formatów pakietu Office — .docx i .xlsx.
//
// POWÓD: warsztat dowodowy czytał dokumenty przez `blob.text()`, co dla .docx i .xlsx
// daje binarne śmieci (oba są archiwami ZIP). W sprawie MBR wypadły przez to KWOTY
// LIMITÓW — 254 i 272 mln zł siedzą w `tabela limity k. 140.xlsx`, a metodyka
// w `.docx`. Model dostawał zamiast nich strumień bajtów i wyodrębniał puste kolumny.
//
// Świadomie BEZ biblioteki do arkuszy: potrzebujemy tekstu do promptu, nie modelu
// komórek. Wyciągamy wspólny słownik ciągów i wartości wierszy — to wystarcza,
// żeby model zobaczył „Limit lokaty do 1 dnia | 254 mln zł | 272 mln zł".
import JSZip from "jszip";

const odslon = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

/** Tekst z .docx — akapity `w:p` rozdzielone nowymi liniami. */
export async function docxText(bytes: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return odslon(
    xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Tekst z .xlsx — wiersze arkuszy jako linie z komórkami rozdzielonymi „ | ".
 *
 * Format przechowuje napisy w osobnym słowniku (`sharedStrings.xml`), a komórki
 * odwołują się do niego indeksem — bez podstawienia dostalibyśmy same liczby
 * bez etykiet, czyli tabelę limitów bez nazw pozycji.
 */
export async function xlsxText(bytes: ArrayBuffer, maxWierszy = 400): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);

  const ss = await zip.file("xl/sharedStrings.xml")?.async("string");
  const slownik: string[] = ss
    ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        odslon([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")),
      )
    : [];

  const arkusze = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const out: string[] = [];
  for (const nazwa of arkusze.sort()) {
    const xml = (await zip.file(nazwa)?.async("string")) ?? "";
    for (const w of xml.split("<row").slice(1)) {
      const komorki: string[] = [];
      for (const c of w.split("<c").slice(1)) {
        const typ = c.match(/\st="([^"]+)"/)?.[1];
        const v = c.match(/<v>([^<]*)<\/v>/)?.[1];
        const inline = c.match(/<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/)?.[1];
        if (inline !== undefined) komorki.push(odslon(inline));
        else if (v === undefined) komorki.push("");
        else if (typ === "s") komorki.push(slownik[Number(v)] ?? "");
        else komorki.push(v);
      }
      const linia = komorki.join(" | ").trim();
      // Wiersze całkowicie puste (same separatory) pomijamy — arkusze bywają
      // rozciągnięte na setki pustych wierszy formatowaniem.
      if (linia.replace(/[|\s]/g, "")) out.push(linia);
      if (out.length >= maxWierszy) return out.join("\n");
    }
  }
  return out.join("\n");
}

/** Tekst z dowolnego z obsługiwanych formatów; pusty string, gdy formatu nie znamy. */
export async function tekstZPliku(nazwa: string, bytes: ArrayBuffer): Promise<string> {
  const n = nazwa.toLowerCase();
  if (n.endsWith(".docx")) return docxText(bytes);
  if (n.endsWith(".xlsx") || n.endsWith(".xlsm")) return xlsxText(bytes);
  if (/\.(txt|csv|md|json)$/.test(n)) return new TextDecoder("utf-8").decode(bytes);
  // .doc i .xls (OLE2) oraz formaty nieznane — świadomie zwracamy pustkę zamiast
  // strumienia bajtów, który zaśmieciłby prompt i mógłby wyprodukować zmyślone dane.
  return "";
}
