import { notFound, redirect } from "next/navigation";

import AppHeader from "@/app/app-header";
import { DOC_TYPES, RECOMMENDED, REQUIRED } from "@/lib/intake/taxonomy";
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
    .select("id,rel_path,size_bytes,doc_type,source,provenance,storage_path")
    .eq("case_id", id)
    .order("rel_path");
  const documents = docs ?? [];

  const { data: metricsData } = await supabase
    .from("metrics")
    .select("key,label,value,unit,session_day,computed_at")
    .eq("case_id", id)
    .order("session_day", { nullsFirst: true });
  const metrics = metricsData ?? [];

  const present = new Set(documents.map((d) => d.doc_type));
  const checklist = REQUIRED.map((code) => ({
    label: DOC_TYPES[code].label,
    present: present.has(code),
  }));
  const recommended = RECOMMENDED.map((code) => ({
    label: DOC_TYPES[code].label,
    present: present.has(code),
  }));

  return (
    <>
      <AppHeader email={user.email ?? ""} />
      <CaseDetail
        caseRow={caseRow}
        documents={documents}
        checklist={checklist}
        recommended={recommended}
        metrics={metrics}
      />
    </>
  );
}
