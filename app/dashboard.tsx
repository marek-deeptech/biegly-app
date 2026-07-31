"use client";

import Link from "next/link";
import { useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui";
import { WSZYSTKIE_PAKIETY, packDla } from "@/lib/domain";

type Case = {
  id: string;
  name: string;
  signature: string | null;
  created_at: string;
  typ?: string | null;
};

export default function Dashboard({
  cases,
  createCase,
}: {
  cases: Case[];
  createCase: (formData: FormData) => Promise<void>;
}) {
  const newCaseRef = useRef<HTMLFormElement>(null);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-inksoft">Rejestr</p>
        <h1 className="text-3xl font-semibold tracking-tight">Sprawy</h1>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-inksoft">Nowa sprawa</h2>
        <form
          ref={newCaseRef}
          action={async (fd) => {
            await createCase(fd);
            newCaseRef.current?.reset();
          }}
          className="flex flex-wrap gap-2 border border-ink/60 bg-card p-3"
        >
          <input
            name="name"
            required
            placeholder="nazwa spółki / sprawy"
            className="flex-1 rounded-lg border border-ink/30 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <input
            name="signature"
            placeholder="sygnatura (np. RP I Ds 4.2019)"
            className="w-56 rounded-lg border border-ink/30 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          {/* Jedyny moment, w którym wybór dziedziny jest realny — potem sprawa niesie
              swój typ sama i wyznacza plan rozdziałów, katalog prawny i silnik. */}
          <select
            name="typ"
            defaultValue="manipulacja_gpw"
            aria-label="Dziedzina opinii"
            className="w-52 rounded-lg border border-ink/30 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          >
            {WSZYSTKIE_PAKIETY.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <AddCaseButton />
        </form>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-inksoft">Lista ({cases.length})</h2>
        {cases.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/30 px-4 py-6 text-center text-sm text-inksoft">
            Brak spraw — dodaj pierwszą powyżej.
          </p>
        ) : (
          <ul className="space-y-2">
            {cases.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/cases/${c.id}`}
                  className="flex items-center justify-between border border-ink/60 bg-card px-4 py-3 hover:border-ink"
                >
                  <span>
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.signature && (
                      <span className="ml-2 text-xs text-inksoft">{c.signature}</span>
                    )}
                    <span className="ml-2 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] text-inksoft">
                      {packDla(c.typ).label}
                    </span>
                  </span>
                  <span className="text-xs text-inksoft">
                    {new Date(c.created_at).toLocaleDateString("pl-PL")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

    </main>
  );
}

function AddCaseButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" loading={pending} loadingLabel="Dodaję…">
      + Sprawa
    </Button>
  );
}
