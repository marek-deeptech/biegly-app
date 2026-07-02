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
    <div className="border-b border-ink/20 bg-paper">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-3 focus-visible:outline-none">
          <span className="text-lg font-semibold tracking-tight">Hochsztapler</span>
          <span className="hidden text-[11px] uppercase tracking-[0.2em] text-inksoft sm:inline">Analiza akt</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-inksoft sm:inline">{email}</span>
          <button
            onClick={signOut}
            className="border border-clay px-3 py-1.5 text-xs uppercase tracking-wider text-clay transition-colors hover:bg-clay hover:text-paper focus-visible:outline-none"
          >
            Wyloguj
          </button>
        </div>
      </div>
    </div>
  );
}
