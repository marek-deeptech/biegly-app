"use client";

import Link from "next/link";
import { useRef } from "react";
import { useFormStatus } from "react-dom";

type Case = {
  id: string;
  name: string;
  signature: string | null;
  created_at: string;
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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Sprawy</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Nowa sprawa</h2>
        <form
          ref={newCaseRef}
          action={async (fd) => {
            await createCase(fd);
            newCaseRef.current?.reset();
          }}
          className="flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white p-3"
        >
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
          <AddCaseButton />
        </form>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Lista ({cases.length})</h2>
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
                  <span className="text-xs text-neutral-500">
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
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
    >
      {pending ? "Dodaję…" : "Dodaj"}
    </button>
  );
}
