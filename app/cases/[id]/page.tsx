import { notFound, redirect } from "next/navigation";

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
    .select("id,rel_path,size_bytes,doc_type,source,provenance")
    .eq("case_id", id)
    .order("rel_path");
  const documents = docs ?? [];

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
    <CaseDetail
      caseRow={caseRow}
      documents={documents}
      checklist={checklist}
      recommended={recommended}
    />
  );
}
