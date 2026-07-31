import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import AppHeader from "./app-header";
import { WSZYSTKIE_PAKIETY } from "@/lib/domain";
import Dashboard from "./dashboard";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  // Awaryjnie: gdyby magic-link trafił z kodem na "/" zamiast na /auth/callback.
  const { code } = await searchParams;
  if (code) redirect(`/auth/callback?code=${code}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: cases } = await supabase
    .from("cases")
    .select("id,name,signature,created_at,typ")
    .order("created_at", { ascending: false });

  async function createCase(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const signature = String(formData.get("signature") ?? "").trim() || null;
    // Nieznana wartość → dziedzina GPW; zbiór dopuszczalnych typów pilnuje rejestr
    // pakietów, nie ograniczenie w bazie (patrz migracja 0010).
    const wybrany = String(formData.get("typ") ?? "");
    const typ = WSZYSTKIE_PAKIETY.some((p) => p.id === wybrany) ? wybrany : "manipulacja_gpw";
    const sb = await createClient();
    await sb.from("cases").insert({ name, signature, typ });
    revalidatePath("/");
  }

  return (
    <>
      <AppHeader email={user.email ?? ""} />
      <Dashboard cases={cases ?? []} createCase={createCase} />
    </>
  );
}
