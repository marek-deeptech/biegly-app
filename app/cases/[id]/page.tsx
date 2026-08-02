import { notFound, redirect } from "next/navigation";

import AppHeader from "@/app/app-header";
import { packDla, wymaganeTypy } from "@/lib/domain";
import { DOC_TYPES } from "@/lib/intake/taxonomy";
import { DOC_TYPES_BANK } from "@/lib/domain/taxonomy-bank";
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
    .select("id,rel_path,size_bytes,doc_type,source,provenance,storage_path,accepted,wytworca,karta_start,karta_end,opis,warstwa_tekstu")
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
  // Lista kontrolna zależy od dziedziny — akta bankowe niosą metodyki limitów
  // i protokoły komitetów, a nie arkusze zleceń.
  const etykiety: Record<string, { label: string }> = { ...DOC_TYPES, ...DOC_TYPES_BANK };
  const { required, recommended: zalecaneTypy } = wymaganeTypy(caseRow.typ, caseRow.rola);
  // Wymóg spełniony, gdy w aktach jest KTÓRYKOLWIEK z jego typów — patrz `GrupaTypow`.
  //
  // Samo „✓" mówi biegłemu za mało: przy uzupełnianiu akt musi wiedzieć, KTÓRY
  // dokument wymóg zamyka i pod jaką kartą go szukać, bo to jego zacytuje w opinii.
  // Dlatego do listy kontrolnej dokładamy opis dokumentu i numer karty.
  const dokDla = (kody: string[]) => {
    const kandydaci = (documents ?? []).filter((d) => kody.includes(d.doc_type));
    // Najpierw ten z numerem karty i opisem — jest najlepiej opisany w aktach.
    return (
      kandydaci.find((d) => d.karta_start != null && d.opis) ??
      kandydaci.find((d) => d.karta_start != null) ??
      kandydaci.find((d) => d.opis) ??
      kandydaci[0]
    );
  };
  const zGrupy = (g: { label: string; kody: string[] }) => {
    const d = g.kody.some(has) ? dokDla(g.kody) : undefined;
    return {
      label: g.kody.length === 1 ? (etykiety[g.kody[0]]?.label ?? g.label) : g.label,
      present: !!d,
      dokument: d?.opis?.trim() || undefined,
      karta: d?.karta_start ?? undefined,
      kartaDo: d?.karta_end ?? undefined,
    };
  };
  const checklist = required.map(zGrupy);
  const recommended = zalecaneTypy.map(zGrupy);

  return (
    <>
      <AppHeader email={user.email ?? ""} dziedzina={packDla(caseRow.typ).label} />
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
