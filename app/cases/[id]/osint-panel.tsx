"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

// A4 — Powiązania OSINT (Krok 5). Recorder miękkich powiązań z OBOWIĄZKOWĄ
// proweniencją: każde ustalenie musi mieć cytowane źródło (URL/rejestr). Bez
// źródła wpis nie jest zapisywany — opinia nie może stać na niezweryfikowanym linku.

type Link = { typ: string; podmioty: string; opis: string; zrodlo: string; data: string };
type Krs = {
  nazwa: string;
  forma: string;
  krs: string;
  nip: string;
  regon: string;
  adres: string;
  email: string;
  www: string;
  stanZDnia: string;
  persons: { funkcja: string; osoba: string }[];
  source: string;
};

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
  const [krs, setKrs] = useState("");
  const [kbusy, setKbusy] = useState(false);
  const [kmsg, setKmsg] = useState("");
  const [fetched, setFetched] = useState<Krs[]>([]);

  async function lookupKrs() {
    const n = krs.replace(/\D/g, "");
    if (!n) return;
    setKbusy(true);
    setKmsg("");
    try {
      const r = await fetch(`/cases/${caseId}/osint/krs?krs=${n}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.reason || `HTTP ${r.status}`);
      const c: Krs = { ...j.company, persons: j.persons ?? [], source: j.source };
      setFetched((f) => [c, ...f.filter((x) => x.krs !== c.krs)]);
      setKrs("");
    } catch (e) {
      setKmsg(`KRS: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setKbusy(false);
    }
  }
  function addFromKrs(c: Krs) {
    const org = c.persons.length
      ? ` · organy (dane zamaskowane w rejestrze publicznym): ${c.persons.slice(0, 6).map((p) => `${p.osoba} (${p.funkcja})`).join(", ")}`
      : "";
    setLinks((l) => [
      ...l,
      {
        typ: "powiązania właścicielskie",
        podmioty: c.nazwa,
        opis: `KRS ${c.krs}, NIP ${c.nip}, adres: ${c.adres}${org}`,
        zrodlo: c.source,
        data: c.stanZDnia,
      },
    ]);
  }

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

  const addrCount = new Map<string, number>();
  fetched.forEach((c) => c.adres && addrCount.set(c.adres, (addrCount.get(c.adres) ?? 0) + 1));

  return (
    <section className="border border-ink/60 bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Powiązania — OSINT (Krok 5)</h2>
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Miękkie powiązania z <strong>publicznie dostępnych źródeł</strong>: rejestry KRS i wspólne zarządy/rady, umowy
        cywilnoprawne, media społecznościowe, powiązania właścicielskie. <strong>Każdy wpis wymaga cytowanego źródła</strong>
        {" "}(URL/rejestr) — bez niego nie zostaje zapisany. Uzupełnia obraz z zawiadomienia KNF o powiązania, których w
        nim nie podniesiono; biegły zatwierdza każde. (KRS — poniżej; web i media społecznościowe — kolejny krok.)
      </p>

      <div className="mb-4 rounded-lg border border-line bg-paper p-3">
        <p className="mb-2 text-xs font-medium">Auto z KRS (oficjalny rejestr, bez klucza)</p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            value={krs}
            onChange={(e) => setKrs(e.target.value)}
            placeholder="numer KRS (10 cyfr)"
            className="w-48 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
          <button
            onClick={lookupKrs}
            disabled={kbusy}
            className="border border-ink px-3 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
          >
            {kbusy ? "Pobieram…" : "Pobierz z KRS"}
          </button>
          {kmsg && <span className="text-xs text-red-600">{kmsg}</span>}
        </div>
        <p className="mb-2 text-[11px] text-inksoft">
          Dane spółki są jawne; skład organów w rejestrze publicznym jest zamaskowany (pełne dane — w odpisie z akt
          sądowych). Wspólny adres kilku podmiotów bywa sygnałem powiązania.
        </p>
        {fetched.map((c) => {
          const shared = !!c.adres && (addrCount.get(c.adres) ?? 0) >= 2;
          return (
            <div key={c.krs} className="mb-2 border border-line p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {c.nazwa || "(bez nazwy)"} <span className="text-inksoft">· KRS {c.krs}</span>
                </span>
                <button onClick={() => addFromKrs(c)} className="shrink-0 text-emerald-700 hover:underline">
                  Dodaj do powiązań
                </button>
              </div>
              <div className="text-inksoft">
                {c.forma}
                {c.nip ? ` · NIP ${c.nip}` : ""}
              </div>
              <div className="text-inksoft">
                Adres: {c.adres || "—"}{" "}
                {shared && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">wspólny adres</span>}
              </div>
              {c.persons.length > 0 && (
                <div className="mt-1 text-inksoft">
                  Organy (zamaskowane): {c.persons.slice(0, 6).map((p) => `${p.osoba} (${p.funkcja})`).join(", ")}
                  {c.persons.length > 6 ? "…" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
