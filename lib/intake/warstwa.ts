// Wykrycie warstwy tekstowej dokumentu — w przeglądarce, przy wgrywaniu do sprawy.
//
// POWÓD: skan bez warstwy tekstowej jest dla analizy plikiem PUSTYM. W sprawie MBR
// wgrano 81 dokumentów, raport kompletności pokazał 10/10, a dziewięć kluczowych
// (postanowienie, zawiadomienie, protokoły komitetu, metodyka limitów) miało zero
// znaków na 125 stronach. Aplikacja nie miała jak o tym powiedzieć, bo nie sprawdzała.
//
// Wykrycie robimy PRZY WGRYWANIU, a nie przy analizie: wtedy biegły od razu wie,
// co wymaga OCR, zamiast dowiadywać się o tym po kilku krokach pracy.

/** Poniżej tylu znaków na stronę uznajemy, że warstwy tekstowej nie ma. */
const PROG_ZNAKOW_NA_STRONE = 80;

export type Warstwa = "jest" | "brak" | "ocr";

/**
 * Czy plik ma czytelną maszynowo treść.
 *
 * `.ocr.pdf` rozpoznajemy po nazwie i oznaczamy jako `ocr` — to wynik naszego
 * własnego przetwarzania, a nie oryginał z akt; rozróżnienie ma znaczenie
 * przy ocenie, co realnie wpłynęło do analizy.
 *
 * Formaty tekstowe (docx, xlsx, csv) mają treść z definicji — nie otwieramy ich,
 * bo koszt jest niepotrzebny. Obrazy nie niosą tekstu i dostają `brak`.
 */
export async function wykryjWarstwe(nazwa: string, plik: Blob): Promise<Warstwa> {
  const n = nazwa.toLowerCase();
  if (n.endsWith(".ocr.pdf")) return "ocr";
  if (/\.(docx|xlsx|xlsm|csv|txt|md|json|rtf)$/.test(n)) return "jest";
  if (/\.(png|jpe?g|gif|tiff?|bmp|webp)$/.test(n)) return "brak";
  if (!n.endsWith(".pdf")) return "jest"; // formaty nieznane — nie zgadujemy braku

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buf = new Uint8Array(await plik.arrayBuffer());
    const dok = await getDocumentProxy(buf);
    const { text, totalPages } = await extractText(dok, { mergePages: true });
    const znakow = String(text ?? "").trim().length;
    return znakow / Math.max(1, totalPages) >= PROG_ZNAKOW_NA_STRONE ? "jest" : "brak";
  } catch {
    // Pliku nie dało się otworzyć — NIE twierdzimy, że ma treść. Fałszywe „jest"
    // zawyżyłoby kompletność akt, a to najgroźniejszy błąd tej aplikacji.
    return "brak";
  }
}
