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

import { createClient } from "@/lib/supabase/client";

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

export default function WiedzaPanel({ dziedzina }: { dziedzina: string }) {
  const [zrodla, setZrodla] = useState<Zrodlo[] | null>(null);
  const [fragmenty, setFragmenty] = useState<Fragment[]>([]);
  const [blad, setBlad] = useState<string | null>(null);

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
