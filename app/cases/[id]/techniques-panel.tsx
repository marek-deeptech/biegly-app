"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { TECH_KINDS, type IVKind } from "@/lib/opinion/chapters";
import { TECHNIQUES, type TechniqueId } from "@/lib/opinion/legal";
import { proposeTechniques } from "@/lib/opinion/techniques-detect";

// A2 — Techniki manipulacji (Krok 3). Propozycja z sygnałów dowodowych (metryki
// silnika) + katalog MAR art. 12; biegły potwierdza. Wybór buduje zestaw rozdziałów.

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };

export default function TechniquesPanel({
  caseId,
  metrics,
  selected,
}: {
  caseId: string;
  metrics: Metric[];
  selected: IVKind[];
}) {
  const router = useRouter();
  const proposals = useMemo(() => proposeTechniques(metrics), [metrics]);
  const initial = selected.length ? selected : proposals.filter((p) => p.auto).map((p) => p.id as IVKind);
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const signalOf = (id: string) => proposals.find((p) => p.id === id);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    setMsg("");
    const ids = TECH_KINDS.filter((k) => sel.has(k));
    const lines = ids.map((k) => {
      const t = TECHNIQUES[k as TechniqueId];
      return `• ${t.label} (${t.mar}; ${t.rd})`;
    });
    const supabase = createClient();
    const { error } = await supabase.from("subanalyses").upsert(
      {
        case_id: caseId,
        kind: "techniki",
        chapter_no: "IV",
        title: "Dobór technik (A2)",
        body_md: ids.length ? `Zidentyfikowane techniki manipulacji:\n${lines.join("\n")}` : "Nie wskazano technik.",
        data: { selected: ids, table: null, findings: [], legalRefs: ids.map((k) => TECHNIQUES[k as TechniqueId].rd) },
        status: "zatwierdzona",
      },
      { onConflict: "case_id,kind" },
    );
    setBusy(false);
    if (error) {
      setMsg(/subanalyses|relation|schema cache/i.test(error.message) ? "Uruchom migrację 0004_subanalyses.sql." : error.message);
      return;
    }
    setMsg(`Zapisano: ${ids.length} technik(i). Zestaw rozdziałów uzasadnień zaktualizowany.`);
    router.refresh();
  }

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Techniki manipulacji (Krok 3)</h2>
      <p className="mb-3 text-xs text-inksoft">
        Propozycja z <strong>sygnałów dowodowych</strong> (z metryk silnika), w oparciu o katalog art. 12 MAR.
        Potwierdź lub odrzuć — wybór buduje zestaw rozdziałów uzasadnień. Brak sygnału? Policz najpierw wskaźniki
        (zakładka Sprawa) albo dodaj technikę ręcznie.
      </p>
      <div className="space-y-2">
        {TECH_KINDS.map((k) => {
          const t = TECHNIQUES[k as TechniqueId];
          const p = signalOf(k);
          return (
            <label key={k} className="flex cursor-pointer items-start gap-3 border border-line bg-paper p-3">
              <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} className="mt-1 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.label}</span>
                  {p?.auto && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">sygnał</span>
                  )}
                </div>
                <div className="text-xs text-inksoft">
                  {t.mar}; {t.rd}
                </div>
                {p && <div className="mt-0.5 text-xs text-inksoft">Sygnał: {p.signal}</div>}
              </div>
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Zapisuję…" : "Zapisz dobór technik"}
        </button>
        {msg && <span className="text-xs text-inksoft">{msg}</span>}
      </div>
    </section>
  );
}
