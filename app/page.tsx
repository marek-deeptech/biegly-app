"use client";

import { useEffect, useState } from "react";

type Health = "checking" | "ok" | "error";

const PHASES = [
  { n: 1, t: "Wgranie i klasyfikacja", d: "upload akt, typ/autor/źródło, checklista braków", done: true },
  { n: 2, t: "Walidacja wejścia (QA #1)", d: "integralność, dziury, błędy liczbowe", done: true },
  { n: 3, t: "Analizy pośrednie", d: "silnik faktów (zwalidowany), OSINT, mapowanie", done: false },
  { n: 4, t: "Robocza opinia + recenzent", d: "mapa pewności, QA #2 adwersarialny", done: false },
];

export default function Home() {
  const [health, setHealth] = useState<Health>("checking");
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setHealth(d.status === "ok" ? "ok" : "error"))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Biegły GPW — analiza akt sprawy</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Wsparcie biegłego sądowego w analizie manipulacji instrumentami finansowymi na GPW.
        </p>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3">
        <Badge label="Silnik Python (Vercel)" state={health} />
        <Badge
          label="Supabase (UE)"
          state={supabaseConfigured ? "ok" : "error"}
          okText="skonfigurowane"
          errText="brak zmiennych"
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Pipeline</h2>
        <ol className="space-y-2">
          {PHASES.map((p) => (
            <li
              key={p.n}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  p.done ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {p.n}
              </span>
              <span className="flex-1">
                <span className="text-sm font-medium">{p.t}</span>
                <span className="block text-xs text-neutral-500">{p.d}</span>
              </span>
              <span className={`text-xs ${p.done ? "text-emerald-700" : "text-neutral-400"}`}>
                {p.done ? "gotowe" : "w budowie"}
              </span>
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
  errText = "błąd",
}: {
  label: string;
  state: Health;
  okText?: string;
  errText?: string;
}) {
  const map = {
    checking: { dot: "bg-amber-400", text: "sprawdzam…", cls: "text-amber-700" },
    ok: { dot: "bg-emerald-500", text: okText, cls: "text-emerald-700" },
    error: { dot: "bg-red-500", text: errText, cls: "text-red-700" },
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
