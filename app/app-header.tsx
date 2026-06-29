"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function AppHeader({ email }: { email: string }) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
        <Link
          href="/"
          className="rounded text-sm font-semibold tracking-tight transition-colors hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          Biegły GPW
        </Link>
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <span className="hidden sm:inline">{email}</span>
          <button
            onClick={signOut}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            Wyloguj
          </button>
        </div>
      </div>
    </div>
  );
}
