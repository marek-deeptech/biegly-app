import { createBrowserClient } from "@supabase/ssr";

// Klient Supabase po stronie przeglądarki (komponenty "use client").
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
