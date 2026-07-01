"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

// A4 — Powiązania OSINT (Krok 5). Recorder miękkich powiązań z OBOWIĄZKOWĄ
// proweniencją: każde ustalenie musi mieć cytowane źródło (URL/rejestr). Bez
// źródła wpis nie jest zapisywany — opinia nie może stać na niezweryfikowanym linku.

type Link = { typ: string; podmioty: string; opis: string; zrodlo: string; data: string };

const TYPES = [
  "wspólny zarząd / rada",
  "umowa cywilnoprawna",
  "media społecznościowe",
  "powiązania właścicielskie",
  "inne",
];

export default function OsintPanel({
  caseId,
  stored,
}: {
  caseId: string;
  stored: { kind: string; data: unknown }[];
}) {
  const router = useRouter();
  const existing = stored.find((s) => s.kind === "powiazania_osint");
  const [links, setLinks] = useState<Link[]>((existing?.data as { osint?: Link[] } | null)?.osint ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function add() {
    setLinks((l) => [...l, { typ: TYPES[0], podmioty: "", opis: "", zrodlo: "", data: "" }]);
  }
  function update(i: number, patch: Partial<Link>) {
    setLinks((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function remove(i: number) {
    setLinks((l) => l.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true);
    setMsg("");
    const clean = links
      .map((l) => ({
        typ: l.typ,
        podmioty: l.podmioty.trim(),
        opis: l.opis.trim(),
        zrodlo: l.zrodlo.trim(),
        data: l.data.trim(),
      }))
      .filter((l) => l.podmioty && l.zrodlo);
    const dropped = links.length - clean.length;
    const table = {
      caption: "Tabela. Powiązania OSINT (każde z cytowanym źródłem)",
      head: ["Typ", "Podmioty", "Opis", "Źródło", "Data"],
      rows: clean.map((l) => [l.typ, l.podmioty, l.opis, l.zrodlo, l.data]),
    };
    const supabase = createClient();
    const { error } = await supabase.from("subanalyses").upsert(
      {
        case_id: caseId,
        kind: "powiazania_osint",
        chapter_no: "IV",
        title: "Powiązania — OSINT (Krok 5)",
        body_md: clean.length
          ? `Ustalono ${clean.length} powiązań OSINT (każde z cytowanym źródłem):\n` +
            clean.map((l) => `• [${l.typ}] ${l.podmioty} — ${l.opis} (źródło: ${l.zrodlo}${l.data ? `, ${l.data}` : ""})`).join("\n")
          : "Brak ustalonych powiązań OSINT.",
        data: {
          osint: clean,
          table,
          findings: clean.map((l) => `${l.podmioty}: ${l.typ} (${l.zrodlo})`),
          legalRefs: ["art. 12 ust. 2 MAR"],
        },
        status: "szkic",
      },
      { onConflict: "case_id,kind" },
    );
    setBusy(false);
    if (error) {
      setMsg(/subanalyses|schema cache|relation/i.test(error.message) ? "Uruchom migrację 0004_subanalyses.sql." : error.message);
      return;
    }
    setLinks(clean);
    setMsg(`Zapisano ${clean.length} powiązań${dropped ? ` (pominięto ${dropped} bez podmiotu lub źródła)` : ""}.`);
    router.refresh();
  }

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Powiązania — OSINT (Krok 5)</h2>
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Miękkie powiązania z <strong>publicznie dostępnych źródeł</strong>: rejestry KRS i wspólne zarządy/rady, umowy
        cywilnoprawne, media społecznościowe, powiązania właścicielskie. <strong>Każdy wpis wymaga cytowanego źródła</strong>
        {" "}(URL/rejestr) — bez niego nie zostaje zapisany. Uzupełnia obraz z zawiadomienia KNF o powiązania, których w
        nim nie podniesiono; biegły zatwierdza każde. (Auto-podpowiedzi z web/KRS — kolejny krok Fazy 5.)
      </p>

      {links.length === 0 && (
        <p className="mb-2 text-xs text-inksoft">Brak powiązań. Dodaj pierwsze — pamiętaj o źródle.</p>
      )}

      <div className="space-y-3">
        {links.map((l, i) => (
          <div key={i} className="border border-line bg-paper p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                value={l.typ}
                onChange={(e) => update(i, { typ: e.target.value })}
                className="rounded-lg border border-ink/30 px-2 py-1.5 text-xs"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                value={l.podmioty}
                onChange={(e) => update(i, { podmioty: e.target.value })}
                placeholder="podmioty/osoby (np. Joyfix ↔ Hub.Tech)"
                className="min-w-0 flex-1 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
              <button
                onClick={() => remove(i)}
                className="text-xs text-red-600 transition-colors hover:text-red-800"
                aria-label="Usuń powiązanie"
              >
                Usuń
              </button>
            </div>
            <input
              value={l.opis}
              onChange={(e) => update(i, { opis: e.target.value })}
              placeholder="opis powiązania"
              className="mb-2 w-full rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={l.zrodlo}
                onChange={(e) => update(i, { zrodlo: e.target.value })}
                placeholder="źródło (URL / rejestr) — wymagane"
                className={`min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-neutral-500 ${
                  l.zrodlo.trim() ? "border-ink/30" : "border-red-300"
                }`}
              />
              <input
                value={l.data}
                onChange={(e) => update(i, { data: e.target.value })}
                placeholder="data dostępu"
                className="w-32 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={add}
          className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper"
        >
          Dodaj powiązanie
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Zapisuję…" : "Zapisz powiązania OSINT"}
        </button>
        {msg && <span className="text-xs text-inksoft">{msg}</span>}
      </div>
    </section>
  );
}
