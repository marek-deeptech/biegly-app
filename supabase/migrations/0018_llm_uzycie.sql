-- Rejestr zużycia API modeli — po to, żeby pytanie „który krok pali budżet"
-- miało gdzie dostać odpowiedź.
--
-- POWÓD: rachunek za API wyczerpywał się co dwa dni, a w kodzie nie było ANI JEDNEGO
-- miejsca zapisującego koszt wywołania. Dwadzieścia dwa miejsca wołały model, wszystkie
-- na Opusie, żadne nie zostawiało śladu. Decyzja „zejdźmy z modelu tutaj" albo „przytnijmy
-- wejście tam" była zgadywaniem — a zgadywanie przy optymalizacji kosztów zwykle trafia
-- w krok tani i zostawia drogi.
--
-- CO Z TEGO WYNIKA: mając etykietę, sprawę i kwotę przy każdym wywołaniu, widać rozkład
-- kosztu po krokach. Dopiero wtedy wolno decydować o modelu, o batchu i o przycięciu
-- wejścia — na danych, nie na wyczuciu.
--
-- APLIKACJA DZIAŁA BEZ TEJ TABELI. Wpis do bazy jest fail-soft: gdy tabeli nie ma,
-- wrapper wyłącza próby zapisu po pierwszym niepowodzeniu i loguje dalej do pliku
-- (~/.biegly-llm/uzycie.jsonl) oraz na konsolę. Migracja włącza trzeci kanał — jedyny,
-- który zbiera dane z Vercela, gdzie system plików jest tylko do odczytu.
--
-- Pisze do niej lib/llm/klient.ts i scripts/llm.py. Nazwy kolumn MUSZĄ się zgadzać
-- z polami WpisZuzycia — wrapper wysyła surowy JSON bez mapowania.
create table if not exists public.llm_uzycie (
  id            bigserial primary key,
  czas          timestamptz not null default now(),
  -- Stabilna nazwa kroku, np. „redakcja-bank/proza". Po niej grupuje raport,
  -- więc zmiana etykiety rozspójnia historię — zmieniać tylko świadomie.
  etykieta      text        not null,
  -- ON DELETE SET NULL, nie CASCADE: usunięcie sprawy nie ma kasować historii
  -- kosztów. Wydane pieniądze pozostają wydane i mają być widoczne w sumach.
  sprawa        uuid        references public.cases(id) on delete set null,
  model         text        not null,
  wejscie       integer     not null default 0,
  wyjscie       integer     not null default 0,
  cache_zapis   integer     not null default 0,
  cache_odczyt  integer     not null default 0,
  -- NULL = model spoza cennika. Widoczna luka jest uczciwsza niż zero, które
  -- w sumie raportu udawałoby wywołanie darmowe.
  usd           numeric(12, 6),
  ms            integer     not null default 0,
  -- „api" = wywołanie opłacone, „cache" = odpowiedź z dysku (koszt 0).
  zrodlo        text        not null default 'api',
  -- „max_tokens" znaczy, że zapłaciliśmy pełną stawkę za odpowiedź nie do użycia.
  -- To jest sygnał do podniesienia limitu, a nie do powtarzania wywołania w kółko.
  stop_reason   text
);

comment on table public.llm_uzycie is
  'Zużycie API modeli: jeden wiersz na wywołanie. Zasilane przez lib/llm/klient.ts i scripts/llm.py.';

-- Raport chodzi po czasie (koszt dzienny), po sprawie (koszt per sprawa)
-- i po etykiecie (koszt per krok) — po jednym indeksie na każde z pytań.
create index if not exists llm_uzycie_czas_idx     on public.llm_uzycie (czas desc);
create index if not exists llm_uzycie_sprawa_idx   on public.llm_uzycie (sprawa);
create index if not exists llm_uzycie_etykieta_idx on public.llm_uzycie (etykieta);

alter table public.llm_uzycie enable row level security;
drop policy if exists "auth all llm_uzycie" on public.llm_uzycie;
create policy "auth all llm_uzycie" on public.llm_uzycie
  for all to authenticated using (true) with check (true);
