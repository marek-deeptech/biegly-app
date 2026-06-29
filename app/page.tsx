import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import Dashboard from "./dashboard";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: cases } = await supabase
    .from("cases")
    .select("id,name,signature,created_at")
    .order("created_at", { ascending: false });

  async function createCase(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const signature = String(formData.get("signature") ?? "").trim() || null;
    const sb = await createClient();
    await sb.from("cases").insert({ name, signature });
    revalidatePath("/");
  }

  async function signOut() {
    "use server";
    const sb = await createClient();
    await sb.auth.signOut();
    redirect("/login");
  }

  return (
    <Dashboard
      email={user.email ?? ""}
      cases={cases ?? []}
      createCase={createCase}
      signOut={signOut}
    />
  );
}
