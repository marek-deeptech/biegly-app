"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function AppHeader({ email }: { email: string }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="border-b border-ink/20 bg-paper">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 focus-visible:outline-none">
          <Image src="/logo.png" alt="Logo Hochsztapler" width={34} height={34} priority className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold tracking-tight">Hochsztapler</span>
          <span className="hidden text-[11px] uppercase tracking-[0.2em] text-inksoft sm:inline">Analiza akt</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-inksoft sm:inline">{email}</span>
          <Button variant="danger" size="sm" onClick={signOut} loading={signingOut} loadingLabel="Wylogowuję…">
            Wyloguj
          </Button>
        </div>
      </div>
    </div>
  );
}
