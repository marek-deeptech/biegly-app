"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// Plakietka dziedziny wynika z `cases.typ` i pojawia się WYŁĄCZNIE wewnątrz sprawy.
// Świadomie nie ma globalnego przełącznika trybu: typ jest cechą sprawy, nie sesji,
// a tryb tworzyłby drugie źródło prawdy, które może być z nim niezgodne (wejście
// z zakładki w sprawę innej dziedziny). Plakietka odczytana z danych nie ma jak skłamać.
export default function AppHeader({ email, dziedzina }: { email: string; dziedzina?: string }) {
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
          {dziedzina ? (
            <>
              <span className="text-inksoft" aria-hidden="true">/</span>
              <span className="rounded-md bg-ink/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-ink">
                {dziedzina}
              </span>
            </>
          ) : (
            <span className="hidden text-[11px] uppercase tracking-[0.2em] text-inksoft sm:inline">Analiza akt</span>
          )}
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
