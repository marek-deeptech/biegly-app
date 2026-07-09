import type { NextConfig } from "next";

// Wykresy w DOCX: font TTF i natywny binding resvg muszą trafić do paczki
// funkcji serverless (readFileSync/require nie są śledzone statycznie).
// Klucz to identyfikator route'u — formaty różnią się między wersjami Next,
// więc podajemy warianty; niedopasowane klucze są ignorowane.
const CHART_ASSETS = [
  "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
  "./node_modules/@resvg/resvg-js*/**",
];

// Analiza OSINT (PDF): fonty IBM Plex Sans czytane przez fs.readFileSync z
// assets/fonts nie są śledzone statycznie — trzeba je dołączyć do paczki funkcji.
const OSINT_ASSETS = ["./assets/fonts/*.ttf"];

// Opinia (PDF): tekst w IBM Plex (pdfmake) + wykresy przez resvg/DejaVu — oba zestawy.
const OPINION_PDF_ASSETS = [...OSINT_ASSETS, ...CHART_ASSETS];

const nextConfig: NextConfig = {
  // Natywny binding resvg nie jest bundlowalny (Turbopack: "non-ecmascript
  // placeable asset") — pakiet zostaje external i ładuje się w runtime
  // z node_modules; tracing dokłada właściwy binding platformy.
  // pdfmake (+ pdfkit) używa dynamicznych require i plików danych (.afm) —
  // również zostaje external, by działał w runtime z node_modules.
  serverExternalPackages: ["@resvg/resvg-js", "pdfmake"],
  outputFileTracingIncludes: {
    "/cases/[id]/opinion/docx": CHART_ASSETS,
    "/cases/[id]/opinion/docx/route": CHART_ASSETS,
    "app/cases/[id]/opinion/docx/route": CHART_ASSETS,
    "/cases/[id]/osint/pdf": OSINT_ASSETS,
    "/cases/[id]/osint/pdf/route": OSINT_ASSETS,
    "app/cases/[id]/osint/pdf/route": OSINT_ASSETS,
    "/cases/[id]/opinion/pdf": OPINION_PDF_ASSETS,
    "/cases/[id]/opinion/pdf/route": OPINION_PDF_ASSETS,
    "app/cases/[id]/opinion/pdf/route": OPINION_PDF_ASSETS,
  },
};

export default nextConfig;
