"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

// Zenek — asystent sprawy (model + narzędzie czytania akt po stronie serwera).
// Zna roster, wskaźniki silnika, ustalenia rozdziałów i wykaz akt; na pytania
// o treść dokumentów czyta pliki ze Storage (PDF/TXT) i cytuje źródła.

type ReadDoc = { name: string; storage_path: string | null };
type Msg = { role: "user" | "zenek"; text: string; read?: ReadDoc[] };

const STARTERS = [
  "Czego brakuje w aktach?",
  "Kto wchodzi w skład Grupy i jakie mamy wskaźniki?",
  "Co zawiera zawiadomienie o zejściu z progów Joyfix?",
  "Które osoby zasiadają w wielu podmiotach?",
];

export default function Zenek({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "zenek",
      text: "Cześć, jestem Zenek — asystent tej sprawy. Znam akta, podmioty i wskaźniki; mogę też przeczytać konkretny dokument. O co pytasz?",
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: question }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch(`/cases/${caseId}/zenek`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, text: m.text })).slice(-12) }),
      });
      const j = await r.json();
      setMsgs((cur) => [
        ...cur,
        j.ok
          ? { role: "zenek", text: j.text as string, read: (j.read ?? []) as ReadDoc[] }
          : { role: "zenek", text: `Nie dałem rady: ${j.reason || `HTTP ${r.status}`}` },
      ]);
    } catch {
      setMsgs((cur) => [...cur, { role: "zenek", text: "Błąd sieci — spróbuj ponownie." }]);
    } finally {
      setBusy(false);
    }
  }

  async function download(d: ReadDoc) {
    if (!d.storage_path) return;
    const supabase = createClient();
    const { data } = await supabase.storage.from("case-files").createSignedUrl(d.storage_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-ink px-4 py-3 text-xs uppercase tracking-wider text-paper shadow-lg transition-opacity hover:opacity-90"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-paper text-[11px] font-semibold text-ink">Z</span>
        Zenek
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[560px] w-[420px] max-w-[calc(100vw-2rem)] flex-col border border-ink bg-paper shadow-xl">
      <div className="flex items-center justify-between border-b border-ink/20 px-3 py-2">
        <span className="flex items-center gap-2 text-xs uppercase tracking-wider">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">Z</span>
          Zenek · asystent sprawy
        </span>
        <button onClick={() => setOpen(false)} className="text-inksoft transition-colors hover:text-ink" aria-label="Zamknij">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto px-3 py-3 text-sm">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[90%] whitespace-pre-wrap px-3 py-2 text-left ${
                m.role === "user" ? "bg-ink text-paper" : "border border-ink/20 bg-card"
              }`}
            >
              {m.text}
            </div>
            {m.read && m.read.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-left">
                {m.read.map((d, j) => (
                  <li key={j} className="flex items-center gap-2 border border-ink/15 bg-card px-2 py-1 text-[11px]">
                    <span className="shrink-0">📄</span>
                    <span className="min-w-0 flex-1 truncate" title={d.name}>
                      {d.name}
                    </span>
                    {d.storage_path && (
                      <button onClick={() => download(d)} className="shrink-0 uppercase tracking-wider text-ink hover:underline">
                        Pobierz
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && (
          <div className="inline-block border border-ink/20 bg-card px-3 py-2 text-xs text-inksoft">
            Zenek pracuje… (może czytać dokumenty)
          </div>
        )}
        {msgs.length === 1 && !busy && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => void ask(s)}
                className="rounded-full border border-ink/20 px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-ink hover:text-paper"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex gap-2 border-t border-ink/20 p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Zapytaj o dokumenty, podmioty, wskaźniki…"
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-ink/30 px-3 py-2 text-sm outline-none focus:border-neutral-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-ink px-3 py-2 text-xs uppercase tracking-wider text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "…" : "Wyślij"}
        </button>
      </form>
    </div>
  );
}
