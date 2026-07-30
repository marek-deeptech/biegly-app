"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui";
import { buildCompleteness, pismoDoOrganu, type DocLite } from "@/lib/intake/completeness";

// Raport kompletności danych wejściowych — pokazuje, CO da się udowodnić z akt,
// zanim biegły zacznie liczyć. Deterministyczny (bez modelu): inwentaryzacja wymogów
// dowodowych → techniki odblokowane/zablokowane → gotowy wniosek do organu.
//
// Powstał z lekcji sprawy ZASTAL: brak arkusza zleceń wykluczał trzy techniki,
// a plik był w aktach pod nazwą „Zestawienie zleceń…" i typem DANE_BROKERSKIE.

export default function CompletenessPanel({
  documents,
  caseName,
  signature,
}: {
  documents: DocLite[];
  caseName: string;
  signature: string | null;
}) {
  const [pokazPismo, setPokazPismo] = useState(false);
  const [skopiowano, setSkopiowano] = useState(false);
  const raport = useMemo(() => buildCompleteness(documents), [documents]);
  const pismo = useMemo(() => pismoDoOrganu(raport, caseName, signature), [raport, caseName, signature]);

  const dostepne = raport.techniki.filter((t) => t.dostepna);
  const zablokowane = raport.techniki.filter((t) => !t.dostepna);

  async function kopiuj() {
    try {
      await navigator.clipboard.writeText(pismo);
      setSkopiowano(true);
      setTimeout(() => setSkopiowano(false), 2000);
    } catch {
      setSkopiowano(false);
    }
  }

  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
          Kompletność materiału dowodowego
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            raport.braki_krytyczne.length
              ? "bg-red-100 text-red-800"
              : zablokowane.length
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {raport.wynik.spelnione}/{raport.wynik.wszystkie} wymogów ({raport.wynik.pct}%)
        </span>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Co <strong>da się udowodnić</strong> z materiału, który jest w aktach — zanim zaczniesz liczyć.
        Wykrywanie dwutorowe: po <strong>typie dokumentu</strong> oraz po <strong>nazwie pliku</strong>
        {" "}(dane bywają w aktach pod obcym typem — jak arkusz zleceń w sprawie ZASTAL).
      </p>

      {raport.braki_krytyczne.length > 0 && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900">
          <strong>Braki krytyczne:</strong> {raport.braki_krytyczne.join("; ")}. Bez nich opinia nie ma
          podstawy — wystąp do organu przed przystąpieniem do analizy.
        </div>
      )}

      {/* ── techniki: co odblokowane, co zablokowane ── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Wykonalne ({dostepne.length})
          </div>
          <ul className="space-y-1">
            {dostepne.map((t) => (
              <li key={t.kind} className="flex gap-1.5 text-xs">
                <span className="text-emerald-700">✓</span>
                <span>{t.label}</span>
              </li>
            ))}
            {!dostepne.length && <li className="text-xs text-inksoft">— brak</li>}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-800">
            Niewykonalne z obecnych akt ({zablokowane.length})
          </div>
          <ul className="space-y-1">
            {zablokowane.map((t) => (
              <li key={t.kind} className="text-xs">
                <span className="text-red-700">✗</span> {t.label}
                <div className="ml-4 text-[11px] text-inksoft">brakuje: {t.brakujace.join(", ")}</div>
              </li>
            ))}
            {!zablokowane.length && <li className="text-xs text-inksoft">— wszystko wykonalne</li>}
          </ul>
        </div>
      </div>

      {/* ── inwentarz wymogów ── */}
      <details className="mb-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Inwentarz wymogów dowodowych ({raport.wynik.spelnione}/{raport.wynik.wszystkie})
        </summary>
        <table className="mt-2 w-full text-[11px]">
          <thead>
            <tr className="border-b border-line text-left text-inksoft">
              <th className="py-1 pr-2">Wymóg</th>
              <th className="py-1 pr-2">Stan</th>
              <th className="py-1">Znalezione pliki</th>
            </tr>
          </thead>
          <tbody>
            {raport.wymogi.map((w) => (
              <tr key={w.wymog.id} className="border-b border-line/50 align-top">
                <td className="py-1.5 pr-2">
                  {w.wymog.label}
                  {w.wymog.krytyczny && <span className="ml-1 text-red-700" title="krytyczny">*</span>}
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {w.spelniony ? (
                    <span className="text-emerald-700">
                      ✓ {w.liczba} {w.via === "nazwa" ? "(po nazwie)" : "(po typie)"}
                    </span>
                  ) : (
                    <span className="text-red-700">✗ brak</span>
                  )}
                </td>
                <td className="py-1.5 text-inksoft">
                  {w.przyklady.length ? w.przyklady.join("; ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-inksoft">
          <span className="text-red-700">*</span> wymóg krytyczny — brak przekreśla rdzeń opinii.
          {" "}&bdquo;(po nazwie)&rdquo; = plik rozpoznany po nazwie mimo innego typu — zweryfikuj zawartość.
        </p>
      </details>

      {/* ── wniosek do organu ── */}
      {pismo && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPokazPismo((v) => !v)}>
              {pokazPismo ? "Ukryj" : "Wniosek do organu"} ({raport.doZamowienia.length})
            </Button>
            {pokazPismo && (
              <Button variant="ghost" size="sm" onClick={kopiuj}>
                {skopiowano ? "Skopiowano ✓" : "Kopiuj treść"}
              </Button>
            )}
          </div>
          {pokazPismo && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-3 text-[11px] leading-relaxed">
              {pismo}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
