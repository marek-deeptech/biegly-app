// Ekstrakcja tekstu z PDF (unpdf — serverless-friendly, czysty JS).
// Używane przez trasy wyciągające dane ze źródeł w aktach (ESPI, KRS, sprawozdania).
import { extractText, getDocumentProxy } from "unpdf";

export async function pdfText(bytes: ArrayBuffer | Uint8Array, maxChars = 6000): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
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
