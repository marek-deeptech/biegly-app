// Ekstrakcja tekstu z PDF (unpdf — serverless-friendly, czysty JS).
// Używane przez trasy wyciągające dane ze źródeł w aktach (ESPI, KRS, sprawozdania).
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Kopia bajtów pod pdf.js.
 *
 * ⚠️ pdf.js PRZEJMUJE bufor na własność i po odczycie zostaje on ODŁĄCZONY
 * (detached) — druga próba użycia tego samego `ArrayBuffer` rzuca
 * „Cannot perform Construct on a detached ArrayBuffer". Boli dopiero wtedy, gdy
 * z jednego pliku czyta się kilka razy: skan mieszczący dwanaście dokumentów akt
 * wymaga dwunastu odczytów zakresów stron. Funkcja biblioteczna nie ma prawa
 * niszczyć swojego wejścia, więc kopiujemy tutaj, raz, u źródła.
 */
const kopia = (bytes: ArrayBuffer | Uint8Array): Uint8Array =>
  new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

export async function pdfText(bytes: ArrayBuffer | Uint8Array, maxChars = 6000): Promise<string> {
  const data = kopia(bytes);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/**
 * Tekst WYBRANEGO ZAKRESU STRON — dla dokumentów będących fragmentem skanu.
 *
 * ⚠️ POWÓD: skaner produkuje pliki, a nie dokumenty. Jeden `SKM_…11470.pdf` liczy
 * 54 strony i mieści dwanaście odrębnych dokumentów akt (migracja 0017 nadała im
 * własne wiersze z `strona_od`/`strona_do`, wskazujące ten sam plik). Czytanie
 * całego pliku i wycinanie okien wokół fraz dawało modelowi 24% treści wybranej
 * przez wyszukiwanie zamiast 100% treści właściwego dokumentu — a to różnica
 * między „w aktach tego nie ma" a „nie doczytaliśmy".
 *
 * Strony liczone od 1, zakres domknięty obustronnie (jak w `strona_od`/`strona_do`).
 */
export async function pdfTextStron(
  bytes: ArrayBuffer | Uint8Array,
  od: number,
  do_: number,
  maxChars = 60_000,
): Promise<string> {
  const data = kopia(bytes);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const strony = Array.isArray(text) ? text : [text];
  // Zakres spoza pliku daje pustkę, a nie wyjątek: wiersz z błędnym zakresem ma
  // zniknąć z materiału jako brak treści, a nie wywalić cały Krok 4.
  return strony
    .slice(Math.max(0, od - 1), Math.min(strony.length, do_))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

// Okna tekstu wokół trafień wzorca — do długich dokumentów (sprawozdania fin.),
// gdzie interesujące tabele leżą głęboko, poza początkiem pliku. Sąsiadujące
// okna są sklejane; wynik przycięty do maxChars.
export function keywordWindows(text: string, pattern: RegExp, radius = 700, maxChars = 9000): string {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  const spans: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = Math.max(0, m.index - radius);
    const e = Math.min(text.length, m.index + radius);
    const last = spans[spans.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
    if (spans.reduce((a, [x, y]) => a + (y - x), 0) > maxChars * 2) break;
  }
  if (!spans.length) return text.slice(0, maxChars);
  return spans.map(([s, e]) => text.slice(s, e)).join("\n[…]\n").slice(0, maxChars);
}

// Wariant zachowujący PODZIAŁ NA LINIE — potrzebny tam, gdzie struktura dokumentu
// niesie znaczenie (nagłówki rozdziałów opinii). `pdfText` zgniata wszystkie białe
// znaki do pojedynczych spacji, przez co nagłówki „IV.4. Wash trades" przestają być
// rozpoznawalne jako osobne wiersze. Tu normalizujemy spacje TYLKO wewnątrz linii.
export async function pdfLines(bytes: ArrayBuffer | Uint8Array, maxChars = 900_000): Promise<string> {
  const data = kopia(bytes);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t\u00a0]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, maxChars);
}
