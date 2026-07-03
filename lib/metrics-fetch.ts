// Pobieranie WSZYSTKICH metryk sprawy z paginacją.
//
// Supabase/PostgREST tnie odpowiedź do max-rows (domyślnie 1000). Sprawa skali
// MLM ma >3000 metryk — pojedynczy select zwracał 1/3 danych i buildery
// widziały obcięty zbiór (puste tabele salda/fixingu). Stąd pętla po stronach.
import type { SupabaseClient } from "@supabase/supabase-js";

export type MetricRow = {
  key: string;
  label?: string | null;
  value: number | null;
  unit: string | null;
  session_day: string | null;
};

const PAGE = 1000;

export async function fetchAllMetrics(
  supabase: SupabaseClient,
  caseId: string,
  columns = "key,value,unit,session_day",
): Promise<MetricRow[]> {
  const out: MetricRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("metrics")
      .select(columns)
      .eq("case_id", caseId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...(data as unknown as MetricRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}
