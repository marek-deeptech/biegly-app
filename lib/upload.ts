import * as tus from "tus-js-client";

// Klucz obiektu w Supabase Storage musi być ASCII — klucze z polskimi znakami
// (ł, ą, ż, ó, ń, ś, ć, ę, ź…) są odrzucane, przez co upload cicho pada.
// Transliterujemy diakrytyki i zamieniamy pozostałe znaki spoza ASCII na „_”.
// Oryginalna nazwa/ścieżka zostaje w `rel_path` (do wyświetlania).
const PL: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
};
export function storageKey(path: string): string {
  let s = path.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => PL[c] ?? c);
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // pozostałe diakrytyki
  s = s.replace(/[^\x20-\x7E]/g, "_"); // cokolwiek jeszcze spoza ASCII → „_”
  // ASCII NIE WYSTARCZY. Storage odrzuca też część znaków drukowalnych — plik
  // „^icex_d (1).csv" (notowania indeksu ICEX, 682 obserwacje) nie wgrał się
  // w ogóle, a wiersz w bazie powstał, więc akta liczyły go jako obecny.
  // Zostawiamy zbiór bezpieczny: litery, cyfry, spacja i . _ - ( ) /
  s = s.replace(/[^A-Za-z0-9 ._\-()/]/g, "_");
  // Wiodące kropki i ukośniki psują ścieżkę obiektu.
  return s.replace(/(^|\/)[.]+/g, "$1_").replace(/\/{2,}/g, "/");
}

// Upload wznawialny (TUS) do Supabase Storage — niezawodny dla dużych plików
// i daje realny postęp w bajtach.
export function uploadResumable(opts: {
  supabaseUrl: string;
  token: string;
  bucket: string;
  path: string;
  file: File;
  onProgress?: (sent: number, total: number) => void;
}): Promise<void> {
  const { supabaseUrl, token, bucket, path, file, onProgress } = opts;
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "true" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: reject,
      onProgress: (sent, total) => onProgress?.(sent, total),
      onSuccess: () => resolve(),
    });
    upload
      .findPreviousUploads()
      .then((prev) => {
        if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      })
      .catch(reject);
  });
}
