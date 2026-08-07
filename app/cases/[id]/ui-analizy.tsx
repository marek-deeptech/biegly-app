"use client";

// Wspólne elementy prezentacji dla paneli analitycznych (kroki Wskaźniki, IV.1–7,
// Historia akcjonariatu, Wskaźniki dodatkowe).
//
// ⚠️ POWÓD ISTNIENIA. Każdy panel miał własną drabinkę rozmiarów: 11 px na podpisy
// tabel, 12 px na treść, nagłówki nieodróżnialne od tekstu, tabele sklejone jedna
// z drugą. Biegły czyta te ekrany godzinami przy pisaniu opinii, a przy czterech
// plikach z osobnymi klasami każda poprawka typografii wymagała czterech poprawek
// i kończyła się rozjazdem. Jedno miejsce = jedna decyzja o wielkości i odstępie.
//
// Zasady: treść 14 px, nagłówek sekcji 16 px półgruby, podpis tabeli 12 px,
// odstęp między blokami to `space-y-8` na kontenerze — światło jest częścią
// czytelności, nie ozdobą.

import type { ReactNode } from "react";

export type Tabela = { caption?: string; head?: string[]; rows?: string[][] };

/** Kontener treści zakładki — wymusza jednolity odstęp między blokami. */
export function TrescZakladki({ children }: { children: ReactNode }) {
  return <div className="mt-6 space-y-8 text-sm leading-relaxed">{children}</div>;
}

/** Nagłówek sekcji wewnątrz zakładki (np. „Kontrast obrotu”, „Dynamika pozycji”). */
export function NaglowekSekcji({ children, opis }: { children: ReactNode; opis?: string }) {
  return (
    <div className="mb-3">
      <h4 className="text-base font-semibold leading-snug">{children}</h4>
      {opis ? <p className="mt-1 text-sm text-inksoft">{opis}</p> : null}
    </div>
  );
}

/**
 * Ustalenia rozdziału — lista zdań z silnika.
 *
 * Bez ucinania w połowie zdania: to są wielkości, które wejdą do opinii, więc
 * czytelnik musi widzieć całe zdanie, a nie jego pierwsze 240 znaków.
 */
export function Ustalenia({ xs, maks = 8 }: { xs?: unknown; maks?: number }) {
  const wszystkie = Array.isArray(xs) ? (xs as string[]).filter(Boolean) : [];
  if (!wszystkie.length) return null;
  const lista = wszystkie.slice(0, maks);
  return (
    <div>
      <ul className="space-y-2.5">
        {lista.map((f) => (
          <li key={f} className="border-l-2 border-ink/40 pl-3">{String(f)}</li>
        ))}
      </ul>
      {wszystkie.length > lista.length ? (
        <p className="mt-2 text-xs text-inksoft">… i {wszystkie.length - lista.length} dalszych ustaleń.</p>
      ) : null}
    </div>
  );
}

/**
 * Kolumna liczbowa idzie do prawej, tekstowa do lewej.
 *
 * ⚠️ Wyrównanie „wszystko poza pierwszą kolumną do prawej" wypychało tytuły
 * raportów na prawą krawędź i czytało się je gorzej niż liczby.
 */
function kolumnyLiczbowe(t: Tabela): boolean[] {
  const rows = t.rows ?? [];
  const ile = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: ile }, (_, j) => {
    const v = rows.map((r) => String(r[j] ?? "").trim()).filter((x) => x && x !== "—");
    if (!v.length) return false;
    const liczbowe = v.filter((x) => /^[+-]?[\d\s .,]+(%|zł|szt\.?|p\.p\.|×)?$/.test(x));
    return liczbowe.length / v.length >= 0.8;
  });
}

/** Tabela danych — podpis nad tabelą, oddech w wierszach, pełna wartość w tytule. */
export function TabelaDanych({ t, maks = 8, uwagaPonad }: { t: Tabela; maks?: number; uwagaPonad?: string }) {
  if (!t?.rows?.length) return null;
  const doPrawej = kolumnyLiczbowe(t);
  return (
    <div>
      {t.caption ? <p className="mb-2 text-xs font-medium text-inksoft">{t.caption}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink/40">
              {(t.head ?? []).map((h, i) => (
                <th
                  key={i}
                  className={`py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-inksoft ${
                    doPrawej[i] ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.slice(0, maks).map((r, i) => (
              <tr key={i} className="border-b border-ink/10">
                {r.map((v, j) => (
                  <td
                    key={j}
                    title={String(v)}
                    className={`py-2 pr-4 ${doPrawej[j] ? "text-right tabular-nums" : "text-left"}`}
                  >
                    {String(v).length > 90 ? `${String(v).slice(0, 90)}…` : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.rows.length > maks ? (
        <p className="mt-2 text-xs text-inksoft">
          … i {t.rows.length - maks} kolejnych wierszy{uwagaPonad ? ` (${uwagaPonad})` : ""}.
        </p>
      ) : null}
    </div>
  );
}

/** Blok zastrzeżeń — wyraźnie oddzielony od ustaleń, bo to co innego. */
export function Zastrzezenia({ tytul, xs }: { tytul: string; xs?: unknown }) {
  const lista = Array.isArray(xs) ? (xs as string[]).filter(Boolean) : [];
  if (!lista.length) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <p className="text-sm font-semibold">{tytul}</p>
      <ul className="mt-2.5 space-y-2 text-sm text-inksoft">
        {lista.map((f) => (
          <li key={f}>{String(f)}</li>
        ))}
      </ul>
    </div>
  );
}
