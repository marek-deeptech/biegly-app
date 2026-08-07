"use client";

// KROK „BAZA WIEDZY" toru bankowego — repozytorium piśmiennictwa i aktów prawnych
// DZIEDZINY sprawy, z linkami do plików źródłowych w Storage.
//
// ⚠️ CO TO JEST, A CZYM NIE JEST. Wiedza to jedyny kanał, którym do opinii wchodzi
// treść SPOZA akt (definicje, przepisy, standardy) — dobór do promptu steruje się
// rangą: akt prawny (5) > organ nadzoru (4) > monografia/doktorat (3) > artykuł (2).
// Fragment doktryny NIE jest ustaleniem sprawy: liczby wychodzą wyłącznie z silnika,
// a cudzy stan faktyczny nie może stać się ustaleniem w tej sprawie.
// Zasilanie: scripts/ingest_wiedza.py --dziedzina bank (fragmenty ZAWSZE ze stroną,
// bo opinia sądowa cytuje doktrynę z podaniem strony).

import { useEffect, useMemo, useState } from "react";

import { rejestrWgRodzaju, statusNaDzien, type AktBankowy } from "@/lib/domain/akty-bankowe";
import { createClient } from "@/lib/supabase/client";

type Sub = { kind: string; data?: unknown };

type Zrodlo = {
  id: string;
  tytul: string;
  autor: string | null;
  rok: number | null;
  wydawca: string | null;
  rodzaj: string;
  ranga: number;
  stron: number | null;
  sygnatura: string | null;
  storage_path: string | null;
  uwagi: string | null;
};
type Fragment = { zrodlo_id: string; znakow: number; pojecia: string[] | null };

const RODZAJ: Record<string, string> = {
  akt_prawny: "akt prawny",
  prezentacja_organu: "organ nadzoru",
  monografia: "monografia",
  doktorat: "doktorat",
  artykul: "artykuł naukowy",
  orzecznictwo: "orzecznictwo",
};

/** Dzień zdarzenia zapamiętany w którejkolwiek subanalizie — dla znaczników rejestru. */
function znanyDzien(subanalyses: Sub[]): string {
  for (const kind of ["otoczenie_prawne", "limity", "chronologia_nadzoru", "makro", "sygnaly_rynkowe"]) {
    const d = (subanalyses.find((s) => s.kind === kind)?.data as { dzienZdarzenia?: string | null } | undefined)
      ?.dzienZdarzenia;
    if (d) return d;
  }
  return "";
}

/** Znacznik statusu aktu względem daty zdarzenia — odpowiedź na „czy MiFID II?". */
function StatusAktu({ akt, dzien }: { akt: AktBankowy; dzien: string }) {
  if (!dzien) return null;
  const s = statusNaDzien(akt, dzien);
  if (s === "po_zdarzeniu")
    return (
      <span
        className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] text-red-800"
        title={`Wszedł w życie ${akt.od} — PO dacie zdarzenia (${dzien}). Nie stanowi podstawy oceny tego zdarzenia.`}
      >
        po zdarzeniu — anachronizm
      </span>
    );
  if (s === "uchylony_przed")
    return (
      <span
        className="rounded-full border border-ink/30 px-2 py-0.5 text-[11px] text-inksoft"
        title={`Obowiązywał do ${akt.do} — przed datą zdarzenia (${dzien}).`}
      >
        uchylony przed zdarzeniem
      </span>
    );
  return (
    <span
      className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800"
      title={akt.wersjonowany ? "Istniał w dacie zdarzenia — ustal WERSJĘ z tej daty." : "Obowiązywał w dacie zdarzenia."}
    >
      {akt.wersjonowany ? "istniał — sprawdź wersję" : "obowiązywał w dacie zdarzenia"}
    </span>
  );
}

const ZAKRES_BS: Record<string, { label: string; title: string }> = {
  wprost: { label: "BS: wprost", title: "Dotyczy banków spółdzielczych wprost" },
  posrednio: { label: "BS: pośrednio", title: "Dotyczy banków spółdzielczych pośrednio (tło systemowe)" },
  warunkowo: { label: "BS: warunkowo", title: "Dotyczy banku spółdzielczego tylko w szczególnej roli — patrz uwaga" },
};

export default function WiedzaPanel({ dziedzina, subanalyses = [] }: { dziedzina: string; subanalyses?: Sub[] }) {
  const [zrodla, setZrodla] = useState<Zrodlo[] | null>(null);
  const [fragmenty, setFragmenty] = useState<Fragment[]>([]);
  const [blad, setBlad] = useState<string | null>(null);
  const dzien = useMemo(() => znanyDzien(subanalyses), [subanalyses]);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: z, error } = await supabase
        .from("wiedza_zrodla")
        .select("id,tytul,autor,rok,wydawca,rodzaj,ranga,stron,sygnatura,storage_path,uwagi")
        .eq("aktywne", true)
        .eq("dziedzina", dziedzina)
        .order("ranga", { ascending: false })
        .order("tytul");
      if (error) {
        setBlad("Nie udało się odczytać repozytorium wiedzy.");
        setZrodla([]);
        return;
      }
      setZrodla(z ?? []);
      const ids = (z ?? []).map((x) => x.id);
      if (ids.length) {
        // Meta fragmentów bez treści — do zliczeń; treść wchodzi wyłącznie do promptów.
        const { data: f } = await supabase
          .from("wiedza")
          .select("zrodlo_id,znakow,pojecia")
          .eq("aktywny", true)
          .in("zrodlo_id", ids);
        setFragmenty((f ?? []) as Fragment[]);
      }
    })();
  }, [dziedzina]);

  const wgZrodla = useMemo(() => {
    const m = new Map<string, { ile: number; znakow: number; pojecia: Map<string, number> }>();
    for (const f of fragmenty) {
      const e = m.get(f.zrodlo_id) ?? { ile: 0, znakow: 0, pojecia: new Map() };
      e.ile += 1;
      e.znakow += f.znakow ?? 0;
      for (const p of f.pojecia ?? []) e.pojecia.set(p, (e.pojecia.get(p) ?? 0) + 1);
      m.set(f.zrodlo_id, e);
    }
    return m;
  }, [fragmenty]);

  async function otworz(z: Zrodlo) {
    if (!z.storage_path) return;
    const { data } = await createClient().storage.from("case-files").createSignedUrl(z.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  const fmt = (n: number) => n.toLocaleString("pl-PL");
  const razem = fragmenty.length;

  return (
    <section className="space-y-4">
      <div className="border border-ink/60 bg-card p-4">
        <h2 className="text-sm font-semibold">Baza wiedzy dziedziny</h2>
        <p className="mt-0.5 text-xs text-inksoft">
          Piśmiennictwo i akty prawne dobrane do dziedziny sprawy — jedyny kanał, którym do opinii
          wchodzi treść spoza akt. Ranga źródła (akt prawny &gt; organ nadzoru &gt; monografia &gt;
          artykuł) steruje pierwszeństwem przy redakcji rozdziałów; przy sprzeczności doktryny
          z przepisem wygrywa przepis. Fragmenty niosą numer strony, bo opinia sądowa cytuje
          doktrynę ze stroną.
        </p>
        {zrodla !== null && (
          <p className="mt-2 text-xs">
            Źródeł aktywnych: <strong>{zrodla.length}</strong> · fragmentów do doboru:{" "}
            <strong>{fmt(razem)}</strong>
          </p>
        )}
        {blad && <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">{blad}</p>}
        {zrodla !== null && !zrodla.length && !blad && (
          <p className="mt-3 border-l-2 border-amber-500 pl-3 text-xs text-inksoft">
            Repozytorium nie ma źródeł dla tej dziedziny — rozdziały przeglądowe (otoczenie prawne,
            wstęp teoretyczny) nie będą miały piśmiennictwa. Zasilenie:{" "}
            <code className="rounded bg-ink/5 px-1">python3 scripts/ingest_wiedza.py --dziedzina bank --dir &lt;katalog&gt; --zapisz</code>
          </p>
        )}
      </div>

      {/* REJESTR REGULACJI — pełny krajobraz prawny banków (w tym spółdzielczych)
          z odnośnikami do tekstów urzędowych. Znaczniki przy dacie zdarzenia
          odpowiadają na pytania w rodzaju „czy MiFID II?": jest w rejestrze,
          ale dla zdarzeń sprzed 3.01.2018 nosi czerwony znacznik anachronizmu. */}
      <div className="border border-ink/60 bg-card p-4">
        <h3 className="text-sm font-semibold">Regulacje dotyczące banków — rejestr z odnośnikami</h3>
        <p className="mt-0.5 text-xs text-inksoft">
          Ustawy, prawo UE, rozporządzenia i rekomendacje nadzoru — z linkami do ISAP, EUR-Lex, KNF
          i BIS (odniesienie albo pobranie tekstu).{" "}
          {dzien ? (
            <>Znaczniki odnoszą każdy akt do daty zdarzenia <strong>{dzien}</strong> — akt „po
            zdarzeniu" nie stanowi podstawy oceny.</>
          ) : (
            <>Po ustaleniu daty zdarzenia (krok „Otoczenie prawne") rejestr oznaczy, które akty
            wtedy obowiązywały, a które są anachronizmem.</>
          )}{" "}
          Do powołania w opinii służy datowany katalog kroku „Otoczenie prawne"; pozycje
          wersjonowane (rekomendacje) wymagają ustalenia wersji z daty zdarzenia.
        </p>
        {rejestrWgRodzaju().map(({ rodzaj, akty }) => (
          <div key={rodzaj.id} className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-inksoft">{rodzaj.label}</p>
            <ul className="mt-1.5 space-y-2">
              {akty.map((a) => (
                <li key={a.id} className="border-l-2 border-ink/40 pl-3 text-xs">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <a
                      href={a.link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                      title={`Otwórz tekst źródłowy: ${a.nazwa}`}
                    >
                      {a.skrot}
                    </a>
                    <span
                      className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px]"
                      title={ZAKRES_BS[a.dotyczyBS]?.title}
                    >
                      {ZAKRES_BS[a.dotyczyBS]?.label}
                    </span>
                    <StatusAktu akt={a} dzien={dzien} />
                    <span className="text-[11px] text-inksoft tabular-nums">
                      {a.wersjonowany ? `pierwsza wersja: ${a.od.slice(0, 4)}` : `${a.od} – ${a.do ?? "nadal"}`}
                    </span>
                  </p>
                  <p className="mt-0.5 text-inksoft">{a.nazwa}</p>
                  <p className="mt-0.5">{a.zakres}</p>
                  {a.uwagaBS ? <p className="mt-0.5 text-[11px] italic text-inksoft">⚠ {a.uwagaBS}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {(zrodla ?? []).map((z) => {
        const st = wgZrodla.get(z.id);
        const topPojecia = [...(st?.pojecia ?? new Map<string, number>()).entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6);
        return (
          <div key={z.id} className="border border-ink/60 bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{z.tytul}</h3>
                <p className="mt-0.5 text-xs text-inksoft">
                  {[z.autor, z.rok ? String(z.rok) : null, z.wydawca].filter(Boolean).join(" · ") || "—"}
                  {z.sygnatura ? ` · ${z.sygnatura}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-ink/30 px-2 py-0.5 text-[11px]">
                  {RODZAJ[z.rodzaj] ?? z.rodzaj}
                </span>
                <span
                  className="rounded-full border border-ink/30 px-2 py-0.5 text-[11px] tabular-nums"
                  title="Ranga źródła 1–5 — pierwszeństwo w doborze do promptu"
                >
                  ranga {z.ranga}
                </span>
                {z.storage_path ? (
                  <button
                    onClick={() => otworz(z)}
                    className="rounded border border-ink/25 px-1.5 py-0.5 text-[11px] text-ink/80 transition-colors hover:border-ink/50 hover:text-ink"
                  >
                    otwórz źródło (PDF)
                  </button>
                ) : (
                  <span className="text-[11px] text-inksoft" title="Źródło bez kopii w Storage — cytowanie wymaga sięgnięcia do oryginału">
                    bez kopii w Storage
                  </span>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-inksoft">
              Fragmentów: <strong className="text-ink">{st?.ile ?? 0}</strong>
              {st?.znakow ? <> · {fmt(st.znakow)} znaków</> : null}
              {z.stron ? <> · {z.stron} stron źródła</> : null}
            </p>
            {topPojecia.length ? (
              <p className="mt-1.5 flex flex-wrap gap-1">
                {topPojecia.map(([p, n]) => (
                  <span key={p} className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px]">
                    {p} · {n}
                  </span>
                ))}
              </p>
            ) : null}
            {z.uwagi ? <p className="mt-1.5 text-[11px] italic text-inksoft">{z.uwagi}</p> : null}
          </div>
        );
      })}
    </section>
  );
}
