import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Wykresy w DOCX: font TTF i natywny binding resvg muszą trafić do paczki
  // funkcji serverless (readFileSync/require nie są śledzone statycznie).
  outputFileTracingIncludes: {
    "/cases/[id]/opinion/docx/route": [
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
      "./node_modules/@resvg/resvg-js-*/**",
    ],
  },
};

export default nextConfig;
