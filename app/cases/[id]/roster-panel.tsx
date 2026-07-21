"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// Krok 2 — roster „Grupy": podmioty OBJĘTE ZARZUTAMI z zawiadomienia.
// Zasada evidence-only: to zakres do potwierdzenia, nie ustalona koordynacja.
// „fragment" = ciąg dopasowywany w nazwach właścicieli rachunków w danych UTP.

type Entity = { name: string; fragment: string; kind?: "podmiot" | "osoba" };
type Roster = { entities?: Entity[]; fragments?: string[]; source?: string; confirmed_at?: string | null };

const fragOf = (name: string) => name.trim().toLowerCase().split(/\s+/)[0] ?? "";

export default function RosterPanel({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [needMigration, setNeedMigration] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("cases").select("group_roster").eq("id", caseId).single();
      if (!alive) return;
      if (error) {
        if (/group_roster|column|schema cache/i.test(error.message)) setNeedMigration(true);
        else setMsg(error.message);
      } else {
        const r = (data?.group_roster ?? null) as Roster | null;
        setEntities(r?.entities ?? []);
        setConfirmedAt(r?.confirmed_at ?? null);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  function add(kind: "podmiot" | "osoba") {
    setEntities((e) => [...e, { name: "", fragment: "", kind }]);
    setDirty(true);
  }
  function update(i: number, patch: Partial<Entity>) {
    setEntities((e) => e.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  }
  function remove(i: number) {
    setEntities((e) => e.filter((_, j) => j !== i));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setMsg("");
    const clean = entities
      .map((e) => ({
        name: e.name.trim(),
        fragment: (e.fragment.trim() || fragOf(e.name)).toLowerCase(),
        kind: e.kind ?? "podmiot",
      }))
      .filter((e) => e.fragment);
    const roster: Roster = {
      entities: clean,
      // Silnik dopasowuje beneficjenta rzeczywistego (spółkę), więc fragmenty do
      // group_fragments bierzemy TYLKO z podmiotów — nazwiska osób nie zmieniają metryk.
      fragments: [...new Set(clean.filter((e) => (e.kind ?? "podmiot") === "podmiot").map((e) => e.fragment))],
      source: "zawiadomienie",
      confirmed_at: new Date().toISOString(),
    };
    const supabase = createClient();
    const { error } = await supabase.from("cases").update({ group_roster: roster }).eq("id", caseId);
    setBusy(false);
    if (error) {
      setMsg(
        /group_roster|column|schema cache/i.test(error.message)
          ? "Uruchom migrację 0005_case_group_roster.sql w Supabase SQL Editor."
          : error.message,
      );
      return;
    }
    setConfirmedAt(roster.confirmed_at ?? null);
    setEntities(clean);
    setDirty(false);
    setMsg(`Zapisano roster: ${clean.length} podmiot(ów).`);
    router.refresh();
  }

  return (
    <section className="mb-8 border border-ink/60 bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
          Podmioty i osoby podejrzane (Krok 2)
        </h2>
        {confirmedAt && (
          <span className="text-xs text-inksoft">
            zatwierdzono {new Date(confirmedAt).toLocaleString("pl-PL")} · {entities.length} podmiot(ów)
          </span>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-inksoft">
        Krąg podmiotów do zbadania. Punktem wyjścia jest <strong>zakres zarzutów z zawiadomienia KNF</strong>
        (kogo wskazano jako podejrzanych) — nie ustalenia gotowej opinii. Aplikacja koroboruje i uzupełnia tę listę
        na podstawie <strong>sygnałów dowodowych</strong> (wspólne adresy IP, pary transakcji wewnątrzgrupowych,
        zbieżność czasowa zleceń), więc może <strong>potwierdzić</strong> krąg z zawiadomienia,
        <strong> rozszerzyć</strong> go o podmiot wykryty w danych, albo <strong>zawęzić</strong>, gdy dla kogoś brak
        śladu w dowodach. „Fragment” to ciąg dopasowywany w nazwach właścicieli rachunków w danych UTP
        (np. <code>joyfix</code>). Sama koordynacja („Grupa”) jest <strong>przedmiotem weryfikacji</strong> w
        zakładkach 3–5, nie założeniem. Roster zasila silnik przy „Przelicz wskaźniki”.
      </p>

      {needMigration ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Brak kolumny <code>group_roster</code> — uruchom migrację{" "}
          <code>0005_case_group_roster.sql</code> w Supabase SQL Editor, aby włączyć roster per sprawa.
        </p>
      ) : loading ? (
        <p className="text-xs text-inksoft">Wczytywanie…</p>
      ) : (
        <>
          {entities.length === 0 && (
            <p className="mb-2 text-xs text-inksoft">
              Brak pozycji. Dodaj podmioty i osoby objęte zarzutami w zawiadomieniu — bez nich silnik użyje
              fragmentów domyślnych.
            </p>
          )}
          {(["podmiot", "osoba"] as const).map((k) => {
            const rows = entities.map((e, i) => ({ e, i })).filter(({ e }) => (e.kind ?? "podmiot") === k);
            return (
              <div key={k} className="mb-3">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-medium">
                    {k === "podmiot"
                      ? `Podmioty prawne podejrzane (${rows.length})`
                      : `Osoby podejrzane (${rows.length})`}
                  </p>
                  <button onClick={() => add(k)} className="text-xs text-inksoft underline-offset-2 hover:underline">
                    + dodaj {k === "podmiot" ? "podmiot" : "osobę"}
                  </button>
                </div>
                {rows.length === 0 ? (
                  <p className="text-[11px] text-inksoft">brak</p>
                ) : (
                  <div className="space-y-2">
                    {rows.map(({ e, i }) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <input
                          value={e.name}
                          onChange={(ev) => update(i, { name: ev.target.value })}
                          onBlur={() => {
                            if (e.name && !e.fragment) update(i, { fragment: fragOf(e.name) });
                          }}
                          placeholder={
                            k === "podmiot" ? "Nazwa podmiotu (np. Joyfix Ltd)" : "Imię i nazwisko (np. Jan Kowalski)"
                          }
                          className="min-w-0 flex-1 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
                        />
                        <input
                          value={e.fragment}
                          onChange={(ev) => update(i, { fragment: ev.target.value })}
                          placeholder="fragment (np. joyfix)"
                          className="w-40 rounded-lg border border-ink/30 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
                        />
                        <button
                          onClick={() => remove(i)}
                          className="text-xs text-red-600 transition-colors hover:text-red-800"
                          aria-label="Usuń pozycję"
                        >
                          Usuń
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="successSolid" size="sm" onClick={save} disabled={!dirty} loading={busy} loadingLabel="Zapisuję…">
              Zapisz i zatwierdź roster
            </Button>
            {msg && <span className="text-xs text-inksoft">{msg}</span>}
          </div>
        </>
      )}
    </section>
  );
}
