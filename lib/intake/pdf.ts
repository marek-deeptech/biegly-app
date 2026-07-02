// Ekstrakcja tekstu z PDF (unpdf — serverless-friendly, czysty JS).
// Używane przez trasy wyciągające dane ze źródeł w aktach (ESPI, KRS).
import { extractText, getDocumentProxy } from "unpdf";

export async function pdfText(bytes: ArrayBuffer | Uint8Array, maxChars = 6000): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}
