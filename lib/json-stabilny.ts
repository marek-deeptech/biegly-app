/**
 * Porównywalny zapis JSON — klucze obiektów posortowane rekurencyjnie.
 *
 * ⚠️ POWÓD. PostgreSQL przechowuje `jsonb` z WŁASNYM porządkiem kluczy (najpierw
 * krótsze, potem bajtowo), więc obiekt zapisany i odczytany wraca w innej kolejności
 * niż go zbudowano. Porównanie `JSON.stringify(zBazy) === JSON.stringify(nowe)` jest
 * wtedy zawsze fałszywe, choć dane są identyczne — w skryptach rozdziałów oznaczało
 * to znacznik „proza starsza od liczb" przy każdym powtórzonym biegu, także bez
 * jakiejkolwiek zmiany wielkości.
 *
 * Tablice zachowują kolejność — w tabelach opinii jest ona znacząca.
 */
export function stabilny(wartosc: unknown): string {
  return JSON.stringify(uporzadkuj(wartosc));
}

function uporzadkuj(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(uporzadkuj);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = uporzadkuj(o[k]);
    return out;
  }
  return v;
}
