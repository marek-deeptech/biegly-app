-- Krok 2: roster „Grupy" per sprawa — podmioty OBJĘTE ZARZUTAMI z zawiadomienia.
-- Zasada evidence-only: to ZAKRES (kogo weryfikować), nie ustalona koordynacja.
-- Koordynację/„Grupę" potwierdza dopiero analiza dowodowa (IP, transakcje, OSINT).
-- Zasila silnik jako group_fragments (substringi dopasowania w danych UTP).
alter table public.cases
  add column if not exists group_roster jsonb;

comment on column public.cases.group_roster is
  'Roster Grupy per sprawa (Krok 2): {entities:[{name,fragment,lei?,rep?}], fragments:[...], source, confirmed_at}. Wejście do silnika (group_fragments). Źródło = zawiadomienie, nie opinia.';
