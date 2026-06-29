"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Case = {
  id: string;
  name: string;
  signature: string | null;
  created_at: string;
};

type Health = "checking" | "ok" | "error";

const PHASES = [
  { n: 1, t: "Wgranie i klasyfikacja", done: true },
  { n: 2, t: "Walidacja wejścia (QA #1)", done: true },
  { n: 3, t: "Analizy pośrednie", done: false },
  { n: 4, t: "Robocza opinia + recenzent", done: false },
];

export default function Dashboard({
  email,
  cases,
  createCase,
  signOut,
}: {
  email: string;
  cases: Case[];
  createCase: (formData: FormData) => Promise<void>;
  signOut: () => Promise<void>;
}) {
  const [health, setHealth] = useState<Health>("checking");
  const supabaseOk = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setHealth(d.status === "ok" ? "ok" : "error"))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Biegły GPW</h1>
          <p className="mt-1 text-sm text-neutral-500">{email}</p>
        </div>
        <form action={signOut}>
          <button className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
            Wyloguj
          </button>
        </form>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3">
        <Badge label="Silnik Python (Vercel)" state={health} />
        <Badge label="Supabase (UE)" state={supabaseOk ? "ok" : "error"} okText="połączone" />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Nowa sprawa</h2>
        <form action={createCase} className="flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white p-3">
          <input
            name="name"
            required
            placeholder="nazwa spółki / sprawy"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <input
            name="signature"
            placeholder="sygnatura (np. RP I Ds 4.2019)"
            className="w-56 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
            Dodaj
          </button>
        </form>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Sprawy ({cases.length})</h2>
        {cases.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-400">
            Brak spraw — dodaj pierwszą powyżej.
          </p>
        ) : (
          <ul className="space-y-2">
            {cases.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/cases/${c.id}`}
                  className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-400"
                >
                  <span>
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.signature && (
                      <span className="ml-2 text-xs text-neutral-500">{c.signature}</span>
                    )}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {new Date(c.created_at).toLocaleDateString("pl-PL")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Pipeline</h2>
        <ol className="flex flex-wrap gap-2">
          {PHASES.map((p) => (
            <li
              key={p.n}
              className={`rounded-lg border px-3 py-2 text-xs ${
                p.done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-neutral-200 bg-white text-neutral-400"
              }`}
            >
              {p.n}. {p.t}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Badge({
  label,
  state,
  okText = "ok",
}: {
  label: string;
  state: Health;
  okText?: string;
}) {
  const map = {
    checking: { dot: "bg-amber-400", text: "sprawdzam…", cls: "text-amber-700" },
    ok: { dot: "bg-emerald-500", text: okText, cls: "text-emerald-700" },
    error: { dot: "bg-red-500", text: "błąd", cls: "text-red-700" },
  }[state];
  return (
    <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      <span className={`flex items-center gap-2 text-xs ${map.cls}`}>
        <span className={`h-2 w-2 rounded-full ${map.dot}`} />
        {map.text}
      </span>
    </div>
  );
}
