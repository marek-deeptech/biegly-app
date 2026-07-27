import { notFound, redirect } from "next/navigation";

import AppHeader from "@/app/app-header";
import { DOC_TYPES, RECOMMENDED, REQUIRED } from "@/lib/intake/taxonomy";
import { fetchAllMetrics } from "@/lib/metrics-fetch";
import { createClient } from "@/lib/supabase/server";
import CaseDetail from "./case-detail";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caseRow } = await supabase.from("cases").select("*").eq("id", id).single();
  if (!caseRow) notFound();

  const { data: docs } = await supabase
    .from("documents")
    .select("id,rel_path,size_bytes,doc_type,source,provenance,storage_path,accepted,wytworca,karta_start,karta_end")
    .eq("case_id", id)
    .order("rel_path");
  const documents = docs ?? [];

  // Paginacja: sprawy skali MLM mają >1000 metryk, a PostgREST tnie odpowiedź
  // do max-rows — pojedynczy select zwracał 1/3 zbioru.
  const metrics = (await fetchAllMetrics(supabase, id, "key,label,value,unit,session_day,computed_at")).map(
    (m) => ({ ...m, label: m.label ?? "" }),
  );

  // Subanalizy (tabela 0004). Gdy migracja jeszcze nieuruchomiona — zapytanie
  // zwróci błąd, więc traktujemy brak danych jako pustą listę.
  const { data: subData } = await supabase
    .from("subanalyses")
    .select("id,kind,chapter_no,title,status,body_md,data,approved_at,updated_at")
    .eq("case_id", id)
    .order("chapter_no");
  const subanalyses = subData ?? [];

  const present = new Set(documents.map((d) => d.doc_type));
  // Alias: w sprawach sądowych „opinia do weryfikacji" to opinia biegłego prokuratury
  // (OPINIA_BIEGLY_PROK) lub innego biegłego — spełnia wymóg pozycji OPINIA_UKNF.
  const has = (code: string) =>
    present.has(code) ||
    (code === "OPINIA_UKNF" && (present.has("OPINIA_BIEGLY_PROK") || present.has("OPINIA_INNY_BIEGLY")));
  const checklist = REQUIRED.map((code) => ({ label: DOC_TYPES[code].label, present: has(code) }));
  const recommended = RECOMMENDED.map((code) => ({ label: DOC_TYPES[code].label, present: has(code) }));

  return (
    <>
      <AppHeader email={user.email ?? ""} />
      <CaseDetail
        caseRow={caseRow}
        documents={documents}
        checklist={checklist}
        recommended={recommended}
        metrics={metrics}
        subanalyses={subanalyses}
      />
    </>
  );
}
