"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// Krok 1 — PYTANIA ORGANU do biegłego, PER SPRAWA. To pytania z postanowienia o powołaniu
// biegłego w TEJ konkretnej sprawie (nie globalne). Napędzają rozdział II „Wnioski": model
// odpowiada na każde z nich wyłącznie z materiału dowodowego sprawy, bez przepisywania z
// weryfikowanej opinii innego biegłego. Zapis w subanalizie kind=pytania_organu (data.questions).

type Data = { questions?: string[]; source?: string };

export default function PytaniaPanel({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [questions, setQuestions] = useState<string[]>([]);
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("subanalyses")
        .select("data")
        .eq("case_id", caseId)
        .eq("kind", "pytania_organu")
        .maybeSingle();
      if (!alive) return;
      const d = (data?.data ?? null) as Data | null;
      setQuestions((d?.questions ?? []).map((q) => String(q)));
      setSource(d?.source ?? "");
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  function update(i: number, v: string) {
    setQuestions((qs) => qs.map((q, j) => (j === i ? v : q)));
    setDirty(true);
  }
  function add() {
    setQuestions((qs) => [...qs, ""]);
    setDirty(true);
  }
  function remove(i: number) {
    setQuestions((qs) => qs.filter((_, j) => j !== i));
    setDirty(true);
  }

  async function suggestFromFiles() {
    setSuggesting(true);
    setMsg("");
    try {
      const res = await fetch(`/cases/${caseId}/questions/suggest`, { method: "POST" });
      const j = (await res.json()) as { ok: boolean; reason?: string; message?: string; questions?: string[] };
      if (!j.ok) {
        setMsg(j.reason ?? "Nie udało się odczytać akt.");
        return;
      }
      const incoming = (j.questions ?? []).map((q) => String(q).trim()).filter(Boolean);
      // Pusta lista → ustaw; niepusta → dołącz nowe (dedup), żeby nie kasować ręcznych edycji.
      setQuestions((cur) => {
        const clean = cur.map((q) => q.trim()).filter(Boolean);
        if (clean.length === 0) return incoming;
        const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
        const seen = new Set(clean.map(key));
        const merged = [...clean];
        for (const q of incoming) {
          if (seen.has(key(q))) continue;
          seen.add(key(q));
          merged.push(q);
        }
        return merged;
      });
      setDirty(true);
      setMsg((j.message ?? `Wczytano ${incoming.length} pytań z akt.`) + " Zweryfikuj i zapisz.");
    } catch (e) {
      setMsg("Błąd: " + (e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg("");
    const clean = questions.map((q) => q.trim()).filter((q) => q.length > 0);
    const supabase = createClient();
    const { error } = await supabase.from("subanalyses").upsert(
      {
        case_id: caseId,
        kind: "pytania_organu",
        chapter_no: "II",
        title: "Pytania organu do biegłego",
        body_md:
          "Pytania z postanowienia o powołaniu biegłego w tej sprawie:\n" +
          clean.map((q, i) => `${i + 1}. ${q}`).join("\n"),
        data: { questions: clean, source: source || undefined },
        status: "zatwierdzona",
      },
      { onConflict: "case_id,kind" },
    );
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setQuestions(clean);
    setDirty(false);
    setMsg(`Zapisano ${clean.length} pytań.`);
    router.refresh();
  }

  return (
    <section className="mb-8 border border-ink/60 bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Pytania organu do biegłego (Krok 1)</h2>
        <span className="text-xs text-inksoft">{questions.length} pytań</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Pytania z <strong>postanowienia o powołaniu biegłego w tej sprawie</strong> — muszą to być pytania tej
        konkretnej sprawy. Napędzają rozdział II „Wnioski”: model odpowiada na <strong>każde z nich</strong> wyłącznie
        na podstawie <strong>materiału dowodowego sprawy</strong> (dane silnika, rozdziały IV), bez przepisywania z
        weryfikowanej opinii innego biegłego.
      </p>

      {!loading && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={suggestFromFiles} loading={suggesting} loadingLabel="Czytam akta…">
            Zaczytaj z akt pytania do biegłego
          </Button>
          <span className="text-[11px] text-inksoft">
            odczyta postanowienie o powołaniu biegłego / pismo z pytaniami i wypełni listę do zatwierdzenia
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-inksoft">Wczytywanie…</p>
      ) : (
        <>
          {questions.length === 0 && (
            <p className="mb-2 text-xs text-inksoft">
              Brak pytań — dodaj pytania z postanowienia tej sprawy (bez nich Wnioski użyją pytań domyślnych).
            </p>
          )}
          <ol className="mb-3 space-y-2">
            {questions.map((q, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-right text-xs text-inksoft">{i + 1}.</span>
                <textarea
                  value={q}
                  onChange={(e) => update(i, e.target.value)}
                  rows={2}
                  placeholder="Treść pytania z postanowienia…"
                  className="min-w-0 flex-1 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
                />
                <button
                  onClick={() => remove(i)}
                  className="mt-1 text-xs text-red-600 transition-colors hover:text-red-800"
                  aria-label="Usuń pytanie"
                >
                  Usuń
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={add} className="text-xs text-inksoft underline-offset-2 hover:underline">
              + dodaj pytanie
            </button>
            <Button variant="successSolid" size="sm" onClick={save} disabled={!dirty} loading={busy} loadingLabel="Zapisuję…">
              Zapisz pytania
            </Button>
            {msg && <span className="text-xs text-inksoft">{msg}</span>}
          </div>
        </>
      )}
    </section>
  );
}
