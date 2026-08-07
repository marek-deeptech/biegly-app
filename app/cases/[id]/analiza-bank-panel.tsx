"use client";

// KROK „ANALIZA EKONOMICZNO-FINANSOWA" toru bankowego — PODZAKŁADKI wg wzorca
// rozdziału V finalnej opinii MBR (PO III Ds 84.2020), tak jak krok „Analiza
// IV.1–7" w dziedzinie GPW jest podzakładkami wg finału HubTech.
//
// ODWZOROWANIE WZORCA JEST JAWNE: mapa modułów A–L (lib/domain/analiza-bank-mapa.ts)
// pokazuje przy każdej literze, która podzakładka albo który krok procesu ją
// realizuje — moduły tła (A–C i K: szeregi i kalendarium; L: otoczenie prawne)
// mają własne kroki, a rdzeń analityczny (D–J) żyje tutaj. Moduły SPOZA wzorca
// (rubryka BS, oceny zrzeszającego, chronologia nadzorcza) to suplement sprawy
// SK Banku — w sprawie typu MBR pozostają puste ZGODNIE ZE STANEM AKT.
//
// To WIDOK na istniejące moduły — dane liczą silnik i trasy (/api/bank,
// /api/sygnaly, warsztat, skrypty ocen i chronologii); żadna podzakładka nie
// liczy sama. Status ✅ mówi „moduł ma dane", 🟡 „czeka na wsad albo
// uruchomienie". Rejestr braków per podzakładka liczy się z akt
// (lib/intake/completeness) — pozycja znika sama, gdy materiał trafi do akt.

import { useMemo, useState } from "react";

import { Button } from "@/components/ui";
import { literyPodzakladki, MAPA_MBR, SUPLEMENT_SK } from "@/lib/domain/analiza-bank-mapa";
import { buildCompleteness } from "@/lib/intake/completeness";

import AnalizaEfPanel from "./analiza-ef-panel";
import WarsztatBankPanel from "./warsztat-bank-panel";
import WskaznikiBankPanel from "./wskazniki-bank-panel";
import WykresyBank from "./wykresy-bank";

type Doc = { id: string; rel_path: string; doc_type: string; storage_path: string | null };
type Sub = { kind: string; status?: string; body_md?: string; data?: unknown };
type Tabela = { caption?: string; head?: string[]; rows?: string[][] };
type DaneModulu = {
  table?: Tabela;
  tables?: Tabela[];
  findings?: string[];
  uwagi?: string[];
  braki?: string[];
  skala?: string;
  podstawa?: string;
  zastrzezenia?: string[];
  dzienZdarzenia?: string | null;
};

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

/** Widok modułu zasilanego trasą albo skryptem — tabele + ustalenia + braki danych. */
function WidokModulu({ d, gdyBrak }: { d: DaneModulu | null; gdyBrak: string }) {
  if (!d) return <p className="mt-3 text-xs italic text-inksoft">{gdyBrak}</p>;
  const tabele = d.tables?.length ? d.tables : d.table ? [d.table] : [];
  return (
    <div className="mt-2">
      {d.skala ? (
        <p className="border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
          <strong className="font-medium">Skala:</strong> {d.skala}
        </p>
      ) : null}
      {tabele.map((t, i) => (
        <Tabelka key={i} t={t} />
      ))}
      {d.findings?.length ? (
        <ul className="mt-3 space-y-1 border-t border-ink/15 pt-3 text-xs">
          {d.findings.map((f, i) => (
            <li key={i} className="border-l-2 border-ink/40 pl-2">{f}</li>
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
      {d.zastrzezenia?.length ? (
        <div className="mt-3 border-l-2 border-red-500 pl-3">
          <p className="text-xs font-medium text-red-800">Zastrzeżenia</p>
          <ul className="mt-1 space-y-0.5 text-xs text-inksoft">
            {d.zastrzezenia.map((z, i) => (
              <li key={i}>{z}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.podstawa ? <p className="mt-2 text-[11px] italic text-inksoft">Podstawa: {d.podstawa}</p> : null}
    </div>
  );
}

function znanyDzien(subanalyses: Sub[]): string {
  for (const kind of ["sygnaly_rynkowe", "otoczenie_prawne", "limity", "chronologia_nadzoru", "makro"]) {
    const d = (subanalyses.find((s) => s.kind === kind)?.data as { dzienZdarzenia?: string | null } | undefined)
      ?.dzienZdarzenia;
    if (d) return d;
  }
  return "";
}

export default function AnalizaBankPanel({
  caseId,
  documents,
  subanalyses,
  onDone,
}: {
  caseId: string;
  documents: Doc[];
  subanalyses: Sub[];
  onDone: () => void;
}) {
  const wg = useMemo(() => new Map(subanalyses.map((s) => [s.kind, s])), [subanalyses]);
  const dane = (kind: string) => (wg.get(kind)?.data ?? null) as DaneModulu | null;

  // Rejestr braków per podzakładka — liczony z akt, nie wpisany ręcznie.
  const kompletnosc = useMemo(() => buildCompleteness(documents, "ryzyko_bankowe"), [documents]);
  const technika = (kind: string) => kompletnosc.techniki.find((t) => t.kind === kind);

  const ZAKLADKI = [
    { id: "sprawozdania" as const, mbr: literyPodzakladki("sprawozdania"),
      label: "Sprawozdania", kinds: ["sprawozdania", "adekwatnosc"],
      tytul: "Analiza sprawozdań finansowych i współczynniki kapitałowe w czasie (wzorzec: MBR V.I–J)",
      gotowe: Boolean(wg.get("wskazniki_bank") || wg.get("sprawozdania")) },
    { id: "sygnaly" as const, mbr: literyPodzakladki("sygnaly"),
      label: "Ratingi i CDS", kinds: ["sygnaly_rynkowe"],
      tytul: "Sygnały rynkowe: groźba obniżki ratingów i notowania CDS (wzorzec: MBR V.G–H)",
      gotowe: Boolean(wg.get("sygnaly_rynkowe")) },
    { id: "media" as const, mbr: literyPodzakladki("media"),
      label: "Prasa i sektor", kinds: ["media", "ekspozycja_sektor"],
      tytul: "Publikacje prasowe oraz skala sektora bankowego wobec gospodarki (wzorzec: MBR V.D–F)",
      gotowe: Boolean(wg.get("media") || wg.get("ekspozycja_sektor")) },
    { id: "rubryka" as const, mbr: "",
      label: "Rubryka EF", kinds: ["analiza_ekonomiczna"],
      tytul: "Rubryka 16 wskaźników banku zrzeszającego z rejestrem braków (suplement SK — poza wzorcem MBR)",
      gotowe: Boolean(wg.get("analiza_ekonomiczna")) },
    { id: "oceny" as const, mbr: "",
      label: "Oceny zrzeszającego", kinds: ["oceny_zrzeszajacego"],
      tytul: "Oceny zrzeszającego wystawione bankowi — stan wiedzy oceniającego (suplement SK)",
      gotowe: Boolean(wg.get("oceny_zrzeszajacego")) },
    { id: "chronologia" as const, mbr: "",
      label: "Chronologia", kinds: ["chronologia_nadzoru"],
      tytul: "Chronologia nadzorcza — datowane działania nadzoru i wskaźniki w czasie (suplement SK)",
      gotowe: Boolean(wg.get("chronologia_nadzoru")) },
    { id: "warsztat" as const, mbr: "",
      label: "Proces i limity", kinds: ["procedury", "limity"],
      tytul: "Proces decyzyjny i metodyka limitów — odtworzenie z dokumentów wewnętrznych (warsztat)",
      gotowe: Boolean(wg.get("procedury") && wg.get("limity")) },
  ];
  const [akt, setAkt] = useState<(typeof ZAKLADKI)[number]["id"]>("sprawozdania");
  const [pokazMape, setPokazMape] = useState(false);
  const aktywna = ZAKLADKI.find((z) => z.id === akt)!;

  // Sygnały rynkowe: trigger /api/sygnaly żyje TUTAJ (rdzeń analizy wg MBR),
  // nie w kroku makro — tam zostały szeregi tła (A–C) i kalendarium (K).
  const [dzien, setDzien] = useState(() => znanyDzien(subanalyses));
  const [busy, setBusy] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  async function policzSygnaly() {
    setBusy(true);
    setBlad(null);
    try {
      const r = await fetch("/api/sygnaly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, dzienZdarzenia: dzien || undefined }),
      });
      const j = await r.json();
      if (!j.ok) setBlad(j.error ?? "Nie udało się policzyć sygnałów rynkowych.");
      else onDone();
    } catch {
      setBlad("Błąd sieci przy liczeniu sygnałów rynkowych.");
    } finally {
      setBusy(false);
    }
  }

  // Braki podzakładki: moduły zablokowane brakiem materiału + skany bez OCR.
  const zablokowane = aktywna.kinds
    .map((k) => ({ kind: k, t: technika(k) }))
    .filter((x) => x.t && !x.t.dostepna);

  return (
    <section className="border border-ink/60 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
          Analiza ekonomiczno-finansowa — podzakładki wg wzorca MBR (rozdz. V)
        </h2>
        <button
          onClick={() => setPokazMape(!pokazMape)}
          className="rounded border border-ink/25 px-2 py-1 text-[11px] hover:border-ink/50"
        >
          {pokazMape ? "Ukryj" : "Pokaż"} mapę wzorca A–L
        </button>
      </div>

      {/* MAPA WZORCA — każda litera rozdziału V opinii MBR i miejsce, które ją
          realizuje. Litery poza tym krokiem (A–C, K, L) wskazują właściwy krok. */}
      {pokazMape && (
        <div className="mt-3 overflow-x-auto border border-ink/20 p-3">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-ink/30 text-left">
                <th className="py-1 pr-2 font-medium">Moduł wzorca MBR</th>
                <th className="py-1 pr-2 font-medium">s.</th>
                <th className="py-1 pr-2 font-medium">Gdzie w aplikacji</th>
                <th className="py-1 pr-2 font-medium">Dane</th>
              </tr>
            </thead>
            <tbody>
              {MAPA_MBR.map((m) => {
                const gdzie =
                  "podzakladka" in m.gdzie
                    ? `podzakładka „${ZAKLADKI.find((z) => "podzakladka" in m.gdzie && z.id === m.gdzie.podzakladka)?.label ?? ""}”`
                    : m.gdzie.krok === "makro"
                      ? "krok „Otoczenie makro”"
                      : "krok „Otoczenie prawne”";
                const ma = m.kinds.some((k) => wg.get(k));
                return (
                  <tr key={m.litery} className="border-b border-ink/10 align-top">
                    <td className="py-1 pr-2">
                      <span className="font-medium">V.{m.litery}</span> {m.tytulMbr}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{m.strona}</td>
                    <td className="py-1 pr-2">{gdzie}</td>
                    <td className="py-1 pr-2">{ma ? "✅" : "🟡"}</td>
                  </tr>
                );
              })}
              {SUPLEMENT_SK.map((s) => (
                <tr key={s.podzakladka} className="border-b border-ink/10 align-top text-inksoft">
                  <td className="py-1 pr-2">— (suplement SK) {s.tytul}</td>
                  <td className="py-1 pr-2">—</td>
                  <td className="py-1 pr-2">podzakładka „{ZAKLADKI.find((z) => z.id === s.podzakladka)?.label}”</td>
                  <td className="py-1 pr-2">{s.kinds.some((k) => wg.get(k)) ? "✅" : "🟡"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11px] text-inksoft">
            Wzorzec: „2021.10.15 OPINIA PO III DS 84 2020”, rozdz. V. Moduły spoza wzorca to
            suplement metodyki zrzeszeniowej (sprawa SK Banku) — w sprawie typu MBR pozostają
            puste zgodnie ze stanem akt.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        {ZAKLADKI.map((z) => (
          <button
            key={z.id}
            onClick={() => setAkt(z.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              akt === z.id ? "border-ink bg-ink text-card" : "border-ink/30 hover:border-ink/60"
            }`}
            title={z.tytul}
          >
            {z.gotowe ? "✅" : "🟡"} {z.mbr ? `${z.mbr} · ` : ""}{z.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-inksoft">{aktywna.tytul}</p>

      {/* REJESTR BRAKÓW podzakładki — z akt, nie z ręki: moduł zablokowany mówi,
          KTÓRYCH dokumentów brakuje; pozycja znika sama po ingeście. */}
      {zablokowane.length ? (
        <div className="mt-3 border-l-2 border-amber-500 pl-3">
          <p className="text-xs font-medium">Brakujący materiał tej podzakładki</p>
          <ul className="mt-1 space-y-1 text-[11px] text-inksoft">
            {zablokowane.map(({ kind, t }) => (
              <li key={kind}>
                ◐ {t!.label} — brakuje: {t!.brakujace.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {akt === "sprawozdania" && (
        <div className="mt-2 -mx-4 border-t border-ink/10 [&>section]:border-0">
          <WskaznikiBankPanel caseId={caseId} documents={documents} subanalyses={subanalyses} onDone={onDone} />
          <div className="px-4">
            <WykresyBank subanalyses={subanalyses} kinds={["wskazniki_bank", "sprawozdania"]} dzien={dzien || null} />
          </div>
        </div>
      )}

      {akt === "sygnaly" && (
        <div className="mt-2">
          <div className="flex flex-wrap items-end gap-2 border-b border-ink/10 pb-3">
            <label className="text-xs">
              <span className="block text-inksoft">Data ocenianego zdarzenia</span>
              <input
                type="date"
                value={dzien}
                onChange={(e) => setDzien(e.target.value)}
                className="mt-1 rounded-lg border border-ink/30 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </label>
            <Button onClick={policzSygnaly} loading={busy} loadingLabel="Liczę…">
              {wg.get("sygnaly_rynkowe") ? "Przelicz CDS i ratingi" : "Policz CDS i ratingi"}
            </Button>
            <p className="text-[11px] text-inksoft">
              Liczy wyłącznie z szeregów w aktach (DANE_RYNKOWE_SZEREG) — brak notowań CDS
              jest ustaleniem o materiale („teza o sygnałach rynkowych bez oparcia liczbowego”),
              nie luką aplikacji.
            </p>
          </div>
          {blad && <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">{blad}</p>}
          <WidokModulu
            d={dane("sygnaly_rynkowe")}
            gdyBrak={
              "Sygnałów rynkowych nie policzono. W sprawie MBR spread CDS Glitnira powyżej " +
              "1000 pb był najsilniejszym zignorowanym sygnałem (rozdz. V.H wzorca) — jeżeli " +
              "akta zawierają szereg CDS lub decyzje ratingowe, uruchom obliczenie powyżej. " +
              "Dla banku bez rynku CDS odpowiednikiem są notowania jego obligacji — pozyskasz " +
              "je w kroku „Otoczenie makro” (pole „obligacje emitenta”, np. bsw0424)."
            }
          />
          <WykresyBank subanalyses={subanalyses} kinds={["sygnaly_rynkowe"]} dzien={dzien || null} />
        </div>
      )}

      {akt === "media" && (
        <div className="mt-2 space-y-4">
          <div>
            <p className="text-xs font-semibold">Publikacje prasowe i komunikaty (MBR V.D–E)</p>
            <WidokModulu
              d={dane("media")}
              gdyBrak={
                "Publikacji nie wyodrębniono — buduje je przebieg warsztatu (podzakładka " +
                "„Proces i limity” → „Odtwórz z akt”); podział na PRZED i PO dacie zdarzenia " +
                "chroni przed wnioskowaniem wstecznym."
              }
            />
          </div>
          <div className="border-t border-ink/10 pt-3">
            <p className="text-xs font-semibold">Skala sektora bankowego wobec gospodarki (MBR V.F)</p>
            <WidokModulu
              d={dane("ekspozycja_sektor")}
              gdyBrak={
                "Miar sektora nie odczytano — buduje je przebieg warsztatu. We wzorcu MBR " +
                "aktywa banków islandzkich sięgały 878% PKB Islandii wobec 67% w Polsce — " +
                "to zestawienie wymaga raportów sektorowych w aktach (NADZOR_KNF, RAPORT_BANK_CENTRALNY)."
              }
            />
          </div>
        </div>
      )}

      {akt === "rubryka" && (
        <div className="mt-2 -mx-4 border-t border-ink/10 [&>section]:border-0">
          <AnalizaEfPanel subanalyses={subanalyses} />
        </div>
      )}

      {akt === "oceny" && (
        <WidokModulu
          d={dane("oceny_zrzeszajacego")}
          gdyBrak={
            "Ocen zrzeszającego nie wczytano. Zasilenie ze skanów ocen: " +
            "python3 scripts/oceny_zrzeszajacego.py <SPRAWA> --zapisz (odczyt, nie interpretacja; " +
            "skala odwrócona: 1 = bardzo dobra, 5 = zagrożenie). Metodyka zrzeszeniowa dotyczy " +
            "banków spółdzielczych — w sprawie typu MBR moduł pozostaje pusty zgodnie ze stanem akt."
          }
        />
      )}

      {akt === "chronologia" && (
        <WidokModulu
          d={dane("chronologia_nadzoru")}
          gdyBrak={
            "Chronologii nadzorczej nie zbudowano. Moduł czyta datowane działania nadzoru " +
            "i wielkości bilansowe z narracji nadzorczej (harmonogram działań, wystąpienia " +
            "pokontrolne) — dla pytań „od kiedy dało się rozpoznać”."
          }
        />
      )}

      {akt === "warsztat" && (
        <div className="mt-2 -mx-4 border-t border-ink/10 pt-3 [&>section>div]:border-x-0">
          <WarsztatBankPanel
            caseId={caseId}
            subanalyses={subanalyses}
            onDone={onDone}
            pokaz={["proces", "limity"]}
          />
        </div>
      )}
    </section>
  );
}
