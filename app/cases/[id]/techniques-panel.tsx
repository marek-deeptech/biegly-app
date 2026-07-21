"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { CATALOG_KINDS, TECH_KINDS, type IVKind } from "@/lib/opinion/chapters";
import { TECHNIQUES, type TechniqueId } from "@/lib/opinion/legal";
import { proposeTechniques } from "@/lib/opinion/techniques-detect";

// A2 — Moduły analizy IV (Krok 3). Propozycja z sygnałów dowodowych (metryki
// silnika) + katalog MAR art. 12; biegły potwierdza. Wybór buduje zestaw rozdziałów
// wg wzorca-matki KM (IV.1 ekon-fin i IV.2 ESPI zawsze; relacje auto-pozycjonowane).
// „aktywnosc" to moduł przeglądowy (nie technika MAR) — stąd specjalna etykieta.

type Metric = { key: string; value: number | null; unit: string | null; session_day: string | null };
type SubRow = { kind: string; data: { events?: { session?: string; chg?: number | null }[] } | null };
// Lista „głównych" plików UTP (te same co dropdown Analizy) — wspólne źródło prawdy
// wyboru pliku: detektor spoofingu liczy z tego samego pliku co reszta wskaźników.
type UtpDoc = { id: string; rel_path: string; storage_path: string | null };

export default function TechniquesPanel({
  caseId,
  metrics,
  selected,
  stored = [],
  utpDocs = [],
  activeUtp = "",
  onSelectUtp,
}: {
  caseId: string;
  metrics: Metric[];
  selected: IVKind[];
  stored?: SubRow[];
  utpDocs?: UtpDoc[];
  activeUtp?: string;
  onSelectUtp?: (storagePath: string) => void;
}) {
  const router = useRouter();
  const proposals = useMemo(() => proposeTechniques(metrics, stored), [metrics, stored]);
  const initial = selected.length ? selected : proposals.filter((p) => p.auto).map((p) => p.id as IVKind);
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Dedykowany detektor Spoofing & Layering (arkusz zleceń) — osobny stan.
  const [spoofBusy, setSpoofBusy] = useState<null | "detect" | "pdf">(null);
  const [spoofMsg, setSpoofMsg] = useState("");
  const signalOf = (id: string) => proposals.find((p) => p.id === id);

  // Krok 1: wykrycie na arkuszu zleceń. Plik = ten sam co wybrany w Analizie (activeUtp);
  // gdy brak wskazania, serverless /api/spoofing dobiera główny plik UTP z akt.
  async function detectSpoofing() {
    setSpoofBusy("detect");
    setSpoofMsg("Analiza arkusza zleceń (wykrywanie layering/spoofing)… to potrwa chwilę.");
    try {
      const r = await fetch(`/api/spoofing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, ...(activeUtp ? { storagePath: activeUtp } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || j.reason || `HTTP ${r.status}`);
      setSpoofMsg(`Wykryto ${j.sessions} sesji ze znamionami layering/spoofing (anulowane kupno ${Number(j.cancelled_buy).toLocaleString("pl-PL")} szt, ${j.layers} warstw). Możesz pobrać raport PDF.`);
      router.refresh();
    } catch (e) {
      setSpoofMsg(`Analiza: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSpoofBusy(null);
    }
  }

  // Krok 2: pobranie raportu PDF (renderowany z wykrytej analizy).
  async function downloadSpoofing() {
    setSpoofBusy("pdf");
    setSpoofMsg("");
    try {
      const r = await fetch(`/cases/${caseId}/opinion/spoofing`);
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.reason || `HTTP ${r.status}`); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "Spoofing_Layering.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setSpoofMsg("Pobrano raport PDF.");
    } catch (e) {
      setSpoofMsg(`PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSpoofBusy(null);
    }
  }

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
    // Kolejność wyboru = kolejność rozdziałów IV: zachowaj porządek już zapisany,
    // nowo dodane dopisz w kolejności katalogu.
    const prev = selected.filter((k) => sel.has(k));
    const ids = [...prev, ...CATALOG_KINDS.filter((k) => sel.has(k) && !prev.includes(k))];
    const lines = ids.map((k) => {
      if (k === "aktywnosc") return "• Aktywność podmiotów z Grupy (moduł przeglądowy)";
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
        body_md: ids.length ? `Zidentyfikowane moduły analizy:\n${lines.join("\n")}` : "Nie wskazano technik.",
        data: {
          selected: ids,
          table: null,
          findings: [],
          legalRefs: ids.filter((k) => TECH_KINDS.includes(k as IVKind)).map((k) => TECHNIQUES[k as TechniqueId].rd),
        },
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
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Które techniki z katalogu <strong>art. 12 MAR</strong> faktycznie wystąpiły. Aplikacja
        <strong> proponuje je z sygnałów dowodowych</strong> policzonych przez silnik (np. wysoki udział anulacji
        zleceń → layering &amp; spoofing; wolumen transakcji wewnątrzgrupowych → wash trades) — każda propozycja
        pokazuje swój <strong>sygnał liczbowy i dzień</strong>, więc widać, skąd wniosek. To weryfikacja hipotez z
        <strong> zawiadomienia KNF</strong>: możesz potwierdzić technikę wskazaną przez KNF,
        <strong> dodać</strong> tę, której KNF nie podniósł, a którą widać w danych, albo <strong>odrzucić</strong>
        tę bez pokrycia w dowodach. Zatwierdzony zestaw buduje rozdziały uzasadnień. Brak sygnału? Policz wskaźniki
        (zakładka Analiza liczbowa) lub dodaj technikę ręcznie.
      </p>
      {/* Wiersz pozycji katalogu — wspólny dla technik MAR i modułu przeglądowego. */}
      {(() => {
        const renderRow = (k: (typeof CATALOG_KINDS)[number]) => {
          const t = k === "aktywnosc" ? null : TECHNIQUES[k as TechniqueId];
          const p = signalOf(k);
          return (
            <div key={k}>
              <label className="flex cursor-pointer items-start gap-3 border border-line bg-paper p-3">
              <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} className="mt-1 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t ? t.label : "Aktywność podmiotów z Grupy"}</span>
                  {p?.auto && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">sygnał</span>
                  )}
                </div>
                <div className="text-xs text-inksoft">
                  {t ? `${t.mar}; ${t.rd}` : "moduł przeglądowy IV (nie technika MAR) — obecność Grupy sesja po sesji; z nim relacje domykają IV, bez niego idą zaraz po ESPI"}
                </div>
                {p && <div className="mt-0.5 text-xs text-inksoft">Sygnał: {p.signal}</div>}
              </div>
            </label>

            {k === "layering" && (
              <div className="ml-8 mt-1 rounded-lg border border-ink/20 bg-paper p-3">
                <p className="mb-2 text-[11px] leading-relaxed text-inksoft">
                  <strong>Dedykowany detektor na arkuszu zleceń.</strong> Wykrywa duże, w większości <strong>anulowane</strong>{" "}
                  zlecenia kupna Grupy na <strong>wielu poziomach cen</strong> (warstwy) przy jednoczesnej sprzedaży po
                  stronie przeciwnej — sygnatura layering/spoofing (MAR zał. I lit. a), per sesja. <strong>Krok 1</strong>{" "}
                  wykrywa i zapisuje analizę; <strong>Krok 2</strong> pobiera raport PDF (metodyka, ranking sesji,
                  kolorowane sekwencje zleceń jak w opracowaniu specjalisty).
                </p>
                {utpDocs.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-inksoft">Plik źródłowy (wspólny z zakładką Analiza liczbowa):</span>
                    <select
                      value={activeUtp}
                      onChange={(e) => onSelectUtp?.(e.target.value)}
                      className="max-w-[260px] rounded-lg border border-ink/30 px-2 py-1 text-[11px]"
                    >
                      {utpDocs.map((d) => (
                        <option key={d.id} value={d.storage_path ?? ""}>
                          {d.rel_path.split("/").pop() || d.rel_path}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={detectSpoofing}
                    disabled={spoofBusy === "pdf"}
                    loading={spoofBusy === "detect"}
                    loadingLabel="Analizuję…"
                  >
                    1 · Wykryj (arkusz zleceń)
                  </Button>
                  <Button
                    variant="successSolid"
                    size="sm"
                    onClick={downloadSpoofing}
                    disabled={spoofBusy === "detect"}
                    loading={spoofBusy === "pdf"}
                    loadingLabel="Generuję PDF…"
                  >
                    2 · Pobierz raport (PDF)
                  </Button>
                </div>
                {spoofMsg && <p className="mt-2 text-[11px] text-inksoft">{spoofMsg}</p>}
              </div>
            )}
            </div>
          );
        };
        return (
          <>
            {/* ── Techniki manipulacji (katalog MAR) ── */}
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-inksoft">
              Techniki manipulacji — katalog MAR
            </p>
            <div className="space-y-2">{CATALOG_KINDS.filter((k) => k !== "aktywnosc").map(renderRow)}</div>

            {/* ── Moduł przeglądowy (nie technika MAR) — wpływa na strukturę rozdz. IV ── */}
            <p className="mb-1 mt-4 border-t border-line pt-3 text-[11px] font-semibold uppercase tracking-wider text-inksoft">
              Moduł przeglądowy rozdziału IV (nie technika MAR)
            </p>
            <div className="space-y-2">{renderRow("aktywnosc")}</div>
          </>
        );
      })()}
      <div className="mt-3 flex items-center gap-2">
        <Button variant="successSolid" size="sm" onClick={save} loading={busy} loadingLabel="Zapisuję…">
          Zapisz dobór technik
        </Button>
        {msg && <span className="text-xs text-inksoft">{msg}</span>}
      </div>
    </section>
  );
}
