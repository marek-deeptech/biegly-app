"use client";

// KROK „OTOCZENIE MAKRO" toru bankowego (wzorzec: opinia MBR, rozdz. V.A–C — inflacja,
// kurs walutowy, stopy procentowe — oraz V.K, s. 73: „Inne istotne wydarzenia
// makroekonomiczne sprzed 11 września 2008 roku").
//
// DWIE WARSTWY O RÓŻNYM STATUSIE DOWODOWYM, celowo NIE zlane w jedno:
// 1. Szeregi z AKT (inflacja, kursy, stopy, indeks) — liczy /api/makro; czego nie ma
//    w aktach jako danych, to jest ustaleniem („w aktach brak szeregu X"), nie luką UI.
// 2. KALENDARIUM świata (kryzysy, wojny, pandemie) — wiedza powszechna z katalogu
//    (lib/domain/kalendarium-makro.ts), TŁO opinii, nie materiał dowodowy.
// Wydarzenia PO dacie zdarzenia — tylko za przełącznikiem, z ostrzeżeniem
// o wnioskowaniu wstecznym (następstwa ≠ stan wiedzy z dnia decyzji).
//
// ⚠️ SYGNAŁY RYNKOWE (CDS, ratingi — wzorzec V.G–H) NIE SĄ tłem makro: to rdzeń
// analizy kontrahenta i żyją jako podzakładka kroku „Analiza ekonomiczno-
// -finansowa”. Ten krok pokrywa moduły V.A–C i V.K wzorca MBR.

import { useMemo, useState } from "react";

import { Button } from "@/components/ui";
import { KATEGORIE_WYDARZEN, wydarzeniaWzgledemDnia } from "@/lib/domain/kalendarium-makro";

import WykresyBank from "./wykresy-bank";

type Tabela = { caption?: string; head?: string[]; rows?: string[][] };
type DaneModulu = {
  table?: Tabela;
  tables?: Tabela[];
  findings?: string[];
  braki?: string[];
  odrzucone?: string[];
  dzienZdarzenia?: string | null;
};
type Sub = { kind: string; data?: unknown };

function Tabelka({ t }: { t?: Tabela }) {
  if (!t?.rows?.length) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      {t.caption ? <p className="text-[11px] font-medium text-inksoft">{t.caption}</p> : null}
      <table className="mt-1 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-ink/30 text-left">
            {(t.head ?? []).map((h, i) => (
              <th key={i} className="py-1.5 pr-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className="border-b border-ink/10 align-top">
              {r.map((c, j) => (
                <td key={j} className="py-1.5 pr-3 tabular-nums">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlokModulu({ tytul, d }: { tytul: string; d: DaneModulu | null }) {
  if (!d) return null;
  const tabele = d.tables?.length ? d.tables : d.table ? [d.table] : [];
  return (
    <div className="border border-ink/60 bg-card p-4">
      <h3 className="text-sm font-semibold">{tytul}</h3>
      {tabele.map((t, i) => (
        <Tabelka key={i} t={t} />
      ))}
      {d.findings?.length ? (
        <ul className="mt-3 space-y-1 border-t border-ink/15 pt-3 text-xs text-inksoft">
          {d.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      ) : null}
      {d.braki?.length ? (
        <div className="mt-3 border-l-2 border-amber-500 pl-3">
          <p className="text-xs font-medium">Czego w aktach NIE MA jako danych</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {d.braki.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function MakroPanel({
  caseId,
  subanalyses,
  onDone,
}: {
  caseId: string;
  subanalyses: Sub[];
  onDone: () => void;
}) {
  const dane = (k: string) => (subanalyses.find((s) => s.kind === k)?.data ?? null) as DaneModulu | null;
  const makro = dane("makro");
  const znany =
    makro?.dzienZdarzenia ??
    (subanalyses.find((s) => s.kind === "sygnaly_rynkowe")?.data as DaneModulu | undefined)?.dzienZdarzenia ??
    (subanalyses.find((s) => s.kind === "chronologia_nadzoru")?.data as DaneModulu | undefined)?.dzienZdarzenia ??
    (subanalyses.find((s) => s.kind === "limity")?.data as DaneModulu | undefined)?.dzienZdarzenia ??
    "";
  const [dzien, setDzien] = useState(znany || "");
  const [busy, setBusy] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [pokazPo, setPokazPo] = useState(false);
  const [kategoria, setKategoria] = useState<string>("");
  // Pozyskiwanie szeregów publicznych (NBP, stooq) — luka nr 1 audytu: bez tego
  // sprawa bez DANE_RYNKOWE_SZEREG w aktach (SK Bank) nie miała żadnego wejścia.
  const [obligacje, setObligacje] = useState("");
  const [pozyskuje, setPozyskuje] = useState(false);
  const [wynikPozyskania, setWynikPozyskania] = useState<{
    pobrane: string[];
    istniejace: string[];
    bledy: string[];
  } | null>(null);

  async function policz() {
    setBusy(true);
    setBlad(null);
    try {
      const r = await fetch("/api/makro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, dzienZdarzenia: dzien || undefined }),
      });
      const j = await r.json();
      if (!j.ok) setBlad(j.error ?? "Nie udało się policzyć modułu makro.");
      else onDone();
    } catch {
      setBlad("Błąd sieci przy liczeniu modułu.");
    } finally {
      setBusy(false);
    }
  }

  async function pozyskaj() {
    setPozyskuje(true);
    setBlad(null);
    setWynikPozyskania(null);
    try {
      const r = await fetch(`/cases/${caseId}/bank/szeregi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dzienZdarzenia: dzien || undefined, obligacje: obligacje || undefined }),
      });
      const j = await r.json();
      if (!j.ok) {
        setBlad(j.reason ?? "Nie udało się pozyskać szeregów.");
        return;
      }
      setWynikPozyskania({ pobrane: j.pobrane ?? [], istniejace: j.istniejace ?? [], bledy: j.bledy ?? [] });
      // Świeżo pozyskane akta od razu przeliczamy — pozyskanie bez przeliczenia
      // zostawiałoby zakładkę wyglądającą tak samo jak przed pozyskaniem.
      if ((j.pobrane ?? []).length || (j.istniejace ?? []).length) await policz();
    } catch {
      setBlad("Błąd sieci przy pozyskiwaniu szeregów.");
    } finally {
      setPozyskuje(false);
    }
  }

  const { przed, po } = useMemo(() => wydarzeniaWzgledemDnia(dzien || null), [dzien]);
  const filtruj = (xs: typeof przed) => (kategoria ? xs.filter((w) => w.kategoria === kategoria) : xs);
  const etykieta = (id: string) => KATEGORIE_WYDARZEN.find((k) => k.id === id)?.label ?? id;

  return (
    <section className="space-y-4">
      <div className="border border-ink/60 bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Otoczenie makroekonomiczne</h2>
            <p className="mt-0.5 text-xs text-inksoft">
              Szeregi z akt (inflacja, kursy, stopy) i kalendarium wydarzeń światowych — wzorzec:
              opinia MBR, rozdz. V.A–C i V.K. Sygnały rynkowe kontrahenta (CDS, ratingi — V.G–H)
              są rdzeniem analizy i żyją w kroku „Analiza ekonomiczno-finansowa”.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block text-inksoft">Data ocenianego zdarzenia</span>
              <input
                type="date"
                value={dzien}
                onChange={(e) => setDzien(e.target.value)}
                className="mt-1 rounded-lg border border-ink/30 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </label>
            <Button onClick={policz} loading={busy} loadingLabel="Liczę…">
              {makro ? "Przelicz szeregi z akt" : "Policz szeregi z akt"}
            </Button>
          </div>
        </div>
        {blad && <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">{blad}</p>}

        {/* POZYSKANIE ŹRÓDEŁ PUBLICZNYCH — wzorzec MBR stał na materiale, który
            biegły pozyskał SAM (załączniki 1–6). Trasa zapisuje szeregi do akt
            z proweniencją „pozyskane przez biegłego" i URL-em źródła; liczy dalej
            ten sam silnik co przy materiale wgranym ręcznie. Kursy walutowe
            świadomie poza kompletem (decyzja klienta). */}
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink/15 pt-3">
          <label className="text-xs">
            <span className="block text-inksoft">Obligacje emitenta (Catalyst, opcjonalnie)</span>
            <input
              type="text"
              value={obligacje}
              onChange={(e) => setObligacje(e.target.value)}
              placeholder="np. bsw0424 (SK Bank)"
              className="mt-1 rounded-lg border border-ink/30 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <Button onClick={pozyskaj} loading={pozyskuje} loadingLabel="Pozyskuję…">
            Pozyskaj szeregi publiczne (NBP, stooq)
          </Button>
          <p className="max-w-md text-[11px] text-inksoft">
            Inflacja CPI, stopa referencyjna, WIG-banki, ropa WTI, złoto NBP — do akt jako
            DANE_RYNKOWE_SZEREG z proweniencją „pozyskane przez biegłego”; po pozyskaniu moduł
            przelicza się sam.
          </p>
        </div>
        {wynikPozyskania && (
          <div className="mt-2 space-y-0.5 text-[11px]">
            {wynikPozyskania.pobrane.map((p) => (
              <p key={p} className="text-emerald-800">✓ pozyskano: {p}</p>
            ))}
            {wynikPozyskania.istniejace.map((p) => (
              <p key={p} className="text-inksoft">= już w aktach: {p}</p>
            ))}
            {wynikPozyskania.bledy.map((b) => (
              <p key={b} className="border-l-2 border-amber-500 pl-2 text-inksoft">✗ {b}</p>
            ))}
          </div>
        )}
        {!makro && (
          <p className="mt-3 text-[11px] text-inksoft">
            Moduł liczy wyłącznie z szeregów danych W AKTACH (typ DANE_RYNKOWE_SZEREG) — czego tam
            nie ma, to zostaje nazwane brakiem, a nie dopisane z internetu. Kalendarium poniżej jest
            niezależne od akt (tło ogólnoświatowe).
          </p>
        )}
      </div>

      <BlokModulu tytul="Szeregi z akt: inflacja, stopy, indeks, surowce" d={makro} />
      {makro ? <WykresyBank subanalyses={subanalyses} kinds={["makro"]} dzien={dzien || null} /> : null}

      <div className="border border-ink/60 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Kalendarium wydarzeń światowych</h3>
            <p className="mt-0.5 text-xs text-inksoft">
              Kryzysy, wojny, pandemie, zwroty polityki pieniężnej — TŁO opinii (wiedza powszechna
              z podanym źródłem), nie materiał dowodowy. Fakty własne sprawy pochodzą z akt
              (chronologia nadzorcza), nie stąd.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setKategoria("")}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${!kategoria ? "border-ink bg-ink text-card" : "border-ink/30 hover:border-ink/60"}`}
            >
              wszystkie
            </button>
            {KATEGORIE_WYDARZEN.map((k) => (
              <button
                key={k.id}
                onClick={() => setKategoria(k.id === kategoria ? "" : k.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${kategoria === k.id ? "border-ink bg-ink text-card" : "border-ink/30 hover:border-ink/60"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        {!dzien && (
          <p className="mt-3 border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
            Bez daty zdarzenia kalendarium nie dzieli się na „przed" i „po" — podaj datę, żeby
            oddzielić stan wiedzy dostępnej w dniu decyzji od jej następstw.
          </p>
        )}

        <ul className="mt-3 space-y-2">
          {filtruj(przed).map((w) => (
            <li key={`${w.dzien}-${w.opis.slice(0, 20)}`} className="border-l-2 border-ink/40 pl-3 text-xs">
              <p>
                <span className="font-medium tabular-nums">{w.dzien}</span>{" "}
                <span className="ml-1 rounded-full bg-ink/5 px-2 py-0.5 text-[11px]">{etykieta(w.kategoria)}</span>
              </p>
              <p className="mt-0.5">{w.opis}</p>
              <p className="mt-0.5 text-[11px] italic text-inksoft">Źródło: {w.zrodlo}</p>
            </li>
          ))}
          {!filtruj(przed).length && (
            <li className="text-xs italic text-inksoft">Brak wydarzeń w tej kategorii przed datą zdarzenia.</li>
          )}
        </ul>

        {dzien && po.length ? (
          <div className="mt-4 border-t border-ink/15 pt-3">
            <button
              onClick={() => setPokazPo(!pokazPo)}
              className="rounded border border-ink/25 px-2 py-1 text-[11px] hover:border-ink/50"
            >
              {pokazPo ? "Ukryj" : "Pokaż"} wydarzenia PO dacie zdarzenia ({po.length})
            </button>
            {pokazPo && (
              <>
                <p className="mt-2 border-l-2 border-red-500 pl-3 text-xs text-inksoft">
                  <strong className="font-medium">Uwaga na wnioskowanie wsteczne:</strong> poniższe
                  wydarzenia nastąpiły PO ocenianej decyzji. Opisują jej następstwa lub późniejsze
                  tło — nie stan wiedzy z dnia decyzji i nie mogą uzasadniać oceny tej decyzji.
                </p>
                <ul className="mt-2 space-y-2">
                  {filtruj(po).map((w) => (
                    <li key={`${w.dzien}-${w.opis.slice(0, 20)}`} className="border-l-2 border-red-400 pl-3 text-xs">
                      <p>
                        <span className="font-medium tabular-nums">{w.dzien}</span>{" "}
                        <span className="ml-1 rounded-full bg-ink/5 px-2 py-0.5 text-[11px]">{etykieta(w.kategoria)}</span>
                      </p>
                      <p className="mt-0.5">{w.opis}</p>
                      <p className="mt-0.5 text-[11px] italic text-inksoft">Źródło: {w.zrodlo}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
