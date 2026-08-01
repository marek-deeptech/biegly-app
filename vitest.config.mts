import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { defineConfig } from "vitest/config";

// .mts, nie .ts — Vite ładuje config natywnie i plik z ESM o rozszerzeniu .ts
// wypisuje ostrzeżenie o niezgodności z CommonJS.
const KATALOG = dirname(fileURLToPath(import.meta.url));

// Testy jednostkowe warstwy TypeScript. Powstały po dniu, w którym sześć cichych
// usterek — zaszyte listy rozjeżdżające się z katalogiem, ranking ucięty limitem,
// martwe wzorce stylu — przeszło niezauważonych, bo pokryty testami był wyłącznie
// silnik w Pythonie, a logika w TS (18 tys. linii) nie miała żadnej siatki.
//
// Zakres celowo wąski: czyste funkcje domenowe. Komponenty React i trasy Next
// wymagałyby środowiska DOM i atrap Supabase — to osobna decyzja, nie ta.
//
// `tests-ts/` obok `tests/` (pytest), bo to dwa runnery nad dwoma warstwami:
// pytest liczy silnik na realnych danych dowodowych, vitest sprawdza logikę TS.
export default defineConfig({
  test: {
    include: ["tests-ts/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": resolve(KATALOG, ".") },
  },
});
