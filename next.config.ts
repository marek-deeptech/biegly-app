import type { NextConfig } from "next";

// Wykresy w DOCX: font TTF i natywny binding resvg muszą trafić do paczki
// funkcji serverless (readFileSync/require nie są śledzone statycznie).
// Klucz to identyfikator route'u — formaty różnią się między wersjami Next,
// więc podajemy warianty; niedopasowane klucze są ignorowane.
const CHART_ASSETS = [
  "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
  "./node_modules/@resvg/resvg-js*/**",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/cases/[id]/opinion/docx": CHART_ASSETS,
    "/cases/[id]/opinion/docx/route": CHART_ASSETS,
    "app/cases/[id]/opinion/docx/route": CHART_ASSETS,
  },
};

export default nextConfig;
