"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <p className="text-xs uppercase tracking-[0.2em] text-inksoft">Analiza akt</p>
      <h1 className="text-2xl font-semibold tracking-tight">Hochsztapler</h1>
      <p className="mb-6 mt-1 text-sm text-inksoft">Logowanie dla zespołu</p>

      {status === "sent" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Wysłaliśmy link logujący na <strong>{email}</strong>. Sprawdź skrzynkę i kliknij link.
        </div>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="adres e-mail"
            className="w-full border border-ink/30 bg-card px-3 py-2 text-sm outline-none focus:border-ink"
          />
          <Button type="submit" variant="primary" size="sm" className="w-full py-2" loading={status === "sending"} loadingLabel="Wysyłam…">
            Wyślij link logujący
          </Button>
          {status === "error" && <p className="text-sm text-red-600">{message}</p>}
        </form>
      )}
    </main>
  );
}
