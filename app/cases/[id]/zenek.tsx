"use client";

import { useRef, useState } from "react";

import { DOC_TYPES } from "@/lib/intake/taxonomy";
import { createClient } from "@/lib/supabase/client";

type ZDoc = {
  id: string;
  rel_path: string;
  doc_type: string;
  provenance: string | null;
  storage_path: string | null;
};
type ZCheck = { label: string; present: boolean };
type Msg = { role: "user" | "zenek"; text: string; docs?: ZDoc[] };

function base(p: string) {
  return p.split("/").pop() || p;
}

function search(query: string, docs: ZDoc[], checklist: ZCheck[]): { text: string; docs: ZDoc[] } {
  const q = query.normalize("NFC").toLowerCase().trim();
  if (!q)
    return { text: "Napisz, czego szukasz — np. umowy, KRS, dane UTP, pliki wyjściowe, albo: czego brakuje.", docs: [] };
  if (/brak|brakuj|czego|komplet|kompletn/.test(q)) {
    const missing = checklist.filter((c) => !c.present).map((c) => c.label);
    return {
      text: missing.length
        ? "Brakuje dokumentów obowiązkowych: " + missing.join(", ") + "."
        : "Komplet dokumentów obowiązkowych jest wgrany.",
      docs: [],
    };
  }
  if (/ile|liczba|ilu/.test(q)) {
    const wej = docs.filter((d) => d.provenance === "wejście").length;
    const wyj = docs.filter((d) => d.provenance === "wyjście").length;
    return { text: `W sprawie jest ${docs.length} dokumentów (${wej} wejściowych, ${wyj} wyjściowych).`, docs: [] };
  }
  if (/wyjśc|wytwór|wytwor|biegłego|opinia|opinii/.test(q)) {
    const out = docs.filter((d) => d.provenance === "wyjście");
    return {
      text: out.length ? `Dokumenty wyjściowe (wytwory biegłego) — ${out.length}:` : "Nie ma w sprawie dokumentów wyjściowych.",
      docs: out.slice(0, 12),
    };
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const matches = docs.filter((d) => {
    const hay = (base(d.rel_path) + " " + (DOC_TYPES[d.doc_type]?.label ?? "")).toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
  return {
    text: matches.length
      ? `Znalazłem ${matches.length} pasujących dokumentów:`
      : "Nic nie znalazłem. Spróbuj nazwą pliku albo typem — np. umowa, KRS, UTP, sprawozdanie, OSINT.",
    docs: matches.slice(0, 12),
  };
}

export default function Zenek({ documents, checklist }: { documents: ZDoc[]; checklist: ZCheck[] }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "zenek", text: "Cześć, jestem Zenek. Pomogę Ci przeszukać dokumenty wgrane do tej sprawy. O co pytasz?" },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const res = search(q, documents, checklist);
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "zenek", text: res.text, docs: res.docs }]);
    setInput("");
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function download(d: ZDoc) {
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
    <div className="fixed bottom-6 right-6 z-40 flex h-[460px] w-[360px] max-w-[calc(100vw-2rem)] flex-col border border-ink bg-paper shadow-xl">
      <div className="flex items-center justify-between border-b border-ink/20 px-3 py-2">
        <span className="flex items-center gap-2 text-xs uppercase tracking-wider">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">Z</span>
          Zenek · dokumenty sprawy
        </span>
        <button onClick={() => setOpen(false)} className="text-inksoft transition-colors hover:text-ink" aria-label="Zamknij">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto px-3 py-3 text-sm">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] px-3 py-2 ${
                m.role === "user" ? "bg-ink text-paper" : "border border-ink/20 bg-card"
              }`}
            >
              {m.text}
            </div>
            {m.docs && m.docs.length > 0 && (
              <ul className="mt-2 space-y-1 text-left">
                {m.docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 border border-ink/15 bg-card px-2 py-1 text-xs">
                    <span className="min-w-0 flex-1 truncate" title={base(d.rel_path)}>
                      {base(d.rel_path)}
                    </span>
                    <span className="shrink-0 text-inksoft">{DOC_TYPES[d.doc_type]?.label ?? d.doc_type}</span>
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
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-ink/20 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="np. umowy, KRS, dane UTP…"
          className="flex-1 border border-ink/30 bg-card px-2 py-1.5 text-sm outline-none focus:border-ink"
        />
        <button type="submit" className="bg-ink px-3 py-1.5 text-xs uppercase tracking-wider text-paper hover:opacity-90">
          Szukaj
        </button>
      </form>
    </div>
  );
}
