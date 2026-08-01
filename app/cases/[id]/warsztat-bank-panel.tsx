"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

// Krok 4 dziedziny bankowej — odpowiednik warsztatu technik MAR, ale odtwarza
// co innego: proces decyzyjny banku i metodykę limitów, a nie sekwencje zleceń.
//
// Data zdarzenia jest tu polem obowiązkowym, nie ozdobą: rozstrzyga, KTÓRE przepisy
// zestawiamy z limitami. Bez niej zestawienie byłoby zgadywaniem, a powołanie CRR
// do decyzji z 2008 r. — błędem, który obrona wytknie natychmiast.

type Sub = { kind: string; data?: unknown };
type Tabela = { caption?: string; head?: string[]; rows?: string[][] };
type DaneWarsztatu = {
  table?: Tabela;
  /** Tabele dodatkowe — np. publikacje PO zdarzeniu, pokazywane osobno i z ostrzeżeniem. */
  tables?: Tabela[];
  findings?: string[];
  przepisy?: string[];
  anachroniczne?: string[];
  bezOcr?: string[];
  zastapioneOcr?: number;
  poZdarzeniu?: number;
  uwagi?: string[];
  awarie?: string[];
  bezDaty?: string[];
  dzienZdarzenia?: string | null;
};

function Tabelka({ t }: { t?: Tabela }) {
  if (!t?.rows?.length) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-ink/30 text-left">
            {(t.head ?? []).map((h) => (
              <th key={h} className="py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className="border-b border-ink/10 align-top">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Blok jednego modułu warsztatu — ta sama rama dla wszystkich czterech rozdziałów. */
function Blok({ tytul, d }: { tytul: string; d: DaneWarsztatu | null }) {
  // Moduł bez tabel, ale z ustaleniami, MUSI się pokazać: „w aktach nie ma danych
  // o skali sektora" jest ustaleniem opinii, a ukryty pusty blok wyglądałby tak
  // samo jak moduł nieuruchomiony.
  const tabele = d?.tables?.length ? d.tables : d?.table ? [d.table] : [];
  if (!tabele.some((t) => t.rows?.length) && !d?.findings?.length) return null;
  return (
    <div className="border border-ink/60 bg-card p-4">
      <h3 className="text-sm font-semibold">{tytul}</h3>
      {tabele.map((t, i) =>
        t.rows?.length ? (
          <div key={i} className={i > 0 ? "mt-4 border-t border-ink/15 pt-3" : undefined}>
            {i > 0 && t.caption ? <p className="text-xs font-medium text-inksoft">{t.caption}</p> : null}
            <Tabelka t={t} />
          </div>
        ) : null,
      )}
      {d?.findings?.length ? (
        <ul className="mt-3 space-y-1 border-t border-ink/15 pt-3 text-xs text-inksoft">
          {d.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      ) : null}
      {d?.przepisy?.length ? (
        <div className="mt-3 border-t border-ink/15 pt-3">
          <p className="text-xs font-medium">Przepisy właściwe w dacie zdarzenia</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {d.przepisy.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {d?.anachroniczne?.length ? (
        <div className="mt-3 border-l-2 border-red-400 pl-3">
          <p className="text-xs font-medium">Nie powoływać — przepisy późniejsze niż zdarzenie</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {d.anachroniczne.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function WarsztatBankPanel({
  caseId,
  subanalyses,
  onDone,
}: {
  caseId: string;
  subanalyses: Sub[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const dane = (k: string) => (subanalyses.find((s) => s.kind === k)?.data ?? null) as DaneWarsztatu | null;
  const proc = dane("procedury");
  const lim = dane("limity");
  const media = dane("media");
  const [dzien, setDzien] = useState(lim?.dzienZdarzenia ?? "");

  async function odtworz() {
    setBusy(true);
    setBlad(null);
    try {
      const r = await fetch(`/cases/${caseId}/bank/warsztat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dzienZdarzenia: dzien }),
      });
      const j = await r.json();
      if (!j.ok) setBlad(j.reason ?? "Nie udało się odtworzyć warsztatu.");
      else onDone();
    } catch {
      setBlad("Błąd sieci przy odtwarzaniu warsztatu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="border border-ink/60 bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Warsztat dowodowy</h2>
            <p className="mt-0.5 text-xs text-inksoft">
              Proces decyzyjny, metodyka limitów, publikacje prasowe i skala sektora — zestawione
              z przepisami obowiązującymi w dacie zdarzenia.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs">
              <span className="block text-inksoft">Data ocenianego zdarzenia</span>
              <input
                type="date"
                value={dzien}
                onChange={(e) => setDzien(e.target.value)}
                className="mt-1 rounded-lg border border-ink/30 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </label>
            <Button onClick={odtworz} loading={busy} loadingLabel="Odtwarzam…">
              {proc?.table?.rows?.length ? "Odtwórz ponownie" : "Odtwórz z akt"}
            </Button>
          </div>
        </div>
        {!dzien && (
          <p className="mt-3 text-xs text-inksoft">
            Bez daty zdarzenia limity nie zostaną zestawione z regulacją — stan prawny zmieniał się w czasie
            (CRR obowiązuje dopiero od 2014 r.).
          </p>
        )}
        {blad && <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">{blad}</p>}
        {proc?.zastapioneOcr ? (
          <p className="mt-3 text-xs text-inksoft">
            {proc.zastapioneOcr} skanów odczytano z wersji po OCR — oryginały pominięto jako duplikaty treści.
          </p>
        ) : null}
        {proc?.awarie?.length ? (
          <p className="mt-2 border-l-2 border-red-500 pl-3 text-xs text-inksoft">
            <strong className="font-medium">Ekstrakcja nie doszła do skutku:</strong>{" "}
            {proc.awarie.join(" ")} Puste tabele NIE oznaczają, że tych danych nie ma w aktach —
            uruchom krok ponownie.
          </p>
        ) : null}
        {proc?.uwagi?.length ? (
          <p className="mt-2 border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
            <strong className="font-medium">Odczyt fragmentaryczny:</strong> {proc.uwagi[proc.uwagi.length - 1]}
          </p>
        ) : null}
        {(media?.poZdarzeniu ?? 0) + (proc?.poZdarzeniu ?? 0) > 0 ? (
          <p className="mt-2 border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
            <strong className="font-medium">Uwaga na wnioskowanie wsteczne:</strong>{" "}
            {[
              proc?.poZdarzeniu ? `${proc.poZdarzeniu} zdarzeń procesu decyzyjnego` : null,
              media?.poZdarzeniu ? `${media.poZdarzeniu} publikacji prasowych` : null,
            ]
              .filter(Boolean)
              .join(" i ")}{" "}
            pochodzi z okresu PO ocenianej decyzji. Opisują jej następstwa, nie stan wiedzy z dnia
            jej podjęcia — w osobnych tabelach poniżej.
          </p>
        ) : null}
        {proc?.bezOcr?.length ? (
          <p className="mt-2 border-l-2 border-red-500 pl-3 text-xs text-inksoft">
            <strong className="font-medium">Luka dowodowa:</strong> {proc.bezOcr.length} dokumentów jest
            nieczytelnych i NIE ma wersji po OCR — ich treść nie weszła do analizy:{" "}
            {proc.bezOcr.slice(0, 3).join(", ")}
            {proc.bezOcr.length > 3 && " …"}
          </p>
        ) : null}
      </div>

      <Blok tytul="Chronologia procesu decyzyjnego" d={proc} />
      <Blok tytul="Limity zaangażowania" d={lim} />
      <Blok tytul="Publikacje prasowe i komunikaty" d={media} />
      <Blok tytul="Skala sektora bankowego wobec gospodarki" d={dane("ekspozycja_sektor")} />
      <Blok tytul="Otoczenie prawne w dacie zdarzenia" d={dane("otoczenie_prawne")} />
    </section>
  );
}
