-- 0009 — REPOZYTORIUM WIEDZY: doktryna, akty prawne i materiały organu nadzoru.
--
-- Cel: aplikacja ma rozpoznawać techniki manipulacji lepiej niż wynika to z samych
-- akt jednej sprawy. Wiedza o tym, CZYM JEST wash trade, jakie okoliczności wskazują
-- na layering i co musi zostać wykazane prawnie, pochodzi z doktryny i przepisów —
-- nie z materiału dowodowego. Dotąd literatura leżała w `documents` przypisana do
-- konkretnej sprawy i była jawnie pomijana przy generowaniu prozy (SKIP_TYPES).
--
-- ⚠️ ZAKRES GLOBALNY — ŚWIADOMIE BEZ `case_id`:
-- To jest jedyna warstwa aplikacji, która NIE należy do żadnej sprawy. Definicja
-- manipulacji z monografii obowiązuje tak samo w sprawie HubTech, jak w sprawie,
-- która wpłynie za dwa lata. Przypisanie wiedzy do sprawy zamykałoby ją tam na zawsze.
--
-- ⚠️ GRANICA WOBEC ZASADY EVIDENCE-ONLY:
-- Wiedza dostarcza METODY, DEFINICJI i PODSTAWY PRAWNEJ. Nigdy faktów o sprawie
-- i nigdy liczb — te pochodzą wyłącznie z silnika. Fragment doktryny opisujący cudzy
-- stan faktyczny nie może stać się ustaleniem w bieżącej opinii. Egzekwowane
-- w prompcie redakcji, nie w schemacie — dlatego przechowujemy `strona_od/do`:
-- każde zdanie oparte na doktrynie musi dać się w opinii zacytować z podaniem strony.

-- ── 1. Źródła (jedna pozycja bibliograficzna = jeden wiersz) ─────────────────
create table if not exists public.wiedza_zrodla (
  id            uuid primary key default gen_random_uuid(),
  tytul         text not null,
  autor         text,
  rok           integer,
  wydawca       text,
  -- monografia | prezentacja_organu | artykul | akt_prawny | orzecznictwo | doktorat
  rodzaj        text not null default 'monografia',
  -- Ranga źródła 1–5: akt prawny (5) > organ nadzoru (4) > monografia/doktorat (3)
  -- > artykuł naukowy (2) > pozostałe (1). Steruje kolejnością doboru do promptu:
  -- przy sprzeczności doktryny z przepisem pierwszeństwo ma przepis.
  ranga         integer not null default 3,
  sygnatura     text,                  -- ISBN / ISSN / CELEX / sygn. akt
  storage_path  text,                  -- kopia źródła w buckecie `case-files`, prefiks wiedza/
  sha256        text,
  stron         integer,
  uwagi         text,
  aktywne       boolean not null default true,
  created_at    timestamptz not null default now()
);
-- Klucz naturalny: tytuł. Świadomie BEZ autora — indeks unikalny na (tytul, autor)
-- nie dedupikuje wierszy z autorem NULL (NULL-e są w indeksie rozróżnialne), a indeks
-- na wyrażeniu coalesce(...) nie daje się użyć w ON CONFLICT z PostgREST.
create unique index if not exists wiedza_zrodla_tytul_uidx on public.wiedza_zrodla(tytul);

-- ── 2. Fragmenty (jednostka wyszukiwania i cytowania) ────────────────────────
create table if not exists public.wiedza (
  id            uuid primary key default gen_random_uuid(),
  zrodlo_id     uuid not null references public.wiedza_zrodla(id) on delete cascade,
  strona_od     integer,               -- numer strony/slajdu — WYMAGANY do cytowania w opinii
  strona_do     integer,
  sekcja        text,                  -- tytuł rozdziału/slajdu, gdy rozpoznany
  tresc         text not null,
  -- Suma kontrolna treści (md5, liczona przy ingeście). Istnieje po to, by dało się
  -- założyć indeks unikalny: btree nie przyjmie pełnej treści (fragmenty sięgają
  -- 4200 znaków, limit wiersza to ~2700 bajtów), a indeks na left(tresc, N) nie
  -- daje się użyć w ON CONFLICT z PostgREST.
  hash          text not null,
  -- Tagi technik: wash | layering | imo | pumpdump | fixing | reversal |
  -- concentration | infomanip | insider | ogolne. Nadawane deterministycznie
  -- (słowa kluczowe), nie przez model — dobór wzorca do opinii sądowej musi
  -- dać się odtworzyć i uzasadnić.
  techniki      text[] not null default '{}',
  pojecia       text[] not null default '{}',
  znakow        integer not null default 0,
  aktywny       boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists wiedza_zrodlo_idx   on public.wiedza(zrodlo_id);
create index if not exists wiedza_techniki_idx on public.wiedza using gin(techniki);
create index if not exists wiedza_pojecia_idx  on public.wiedza using gin(pojecia);

-- Wyszukiwanie pełnotekstowe po polsku. Konfiguracja 'polish' bywa niedostępna
-- w Supabase — wtedy 'simple' (bez stemmingu, ale działa); stąd blok warunkowy.
do $$
declare cfg text;
begin
  select case when exists (select 1 from pg_ts_config where cfgname = 'polish')
              then 'polish' else 'simple' end into cfg;
  execute format(
    'create index if not exists wiedza_fts_idx on public.wiedza using gin (to_tsvector(%L, tresc))', cfg);
end $$;

-- Jeden fragment o danej treści na źródło — ponowny ingest nadpisuje, nie duplikuje.
-- Bez `strona_od` w kluczu: gdyby chunking się zmienił i ten sam akapit trafił na inną
-- stronę, powstałby duplikat. Treść jest tu identycznością fragmentu.
create unique index if not exists wiedza_frag_uidx on public.wiedza(zrodlo_id, hash);

alter table public.wiedza_zrodla enable row level security;
alter table public.wiedza        enable row level security;
drop policy if exists "auth all wiedza_zrodla" on public.wiedza_zrodla;
drop policy if exists "auth all wiedza"        on public.wiedza;
create policy "auth all wiedza_zrodla" on public.wiedza_zrodla
  for all to authenticated using (true) with check (true);
create policy "auth all wiedza" on public.wiedza
  for all to authenticated using (true) with check (true);

comment on table  public.wiedza_zrodla       is 'Pozycje bibliograficzne repozytorium wiedzy — globalne, niezwiązane ze sprawą';
comment on column public.wiedza_zrodla.ranga is 'Ranga źródła 1-5: akt prawny 5, organ nadzoru 4, monografia 3, artykuł 2 — steruje pierwszeństwem w prompcie';
comment on table  public.wiedza              is 'Fragmenty doktryny i przepisów; dostarczają METODY i PODSTAWY PRAWNEJ, nigdy faktów o sprawie ani liczb';
comment on column public.wiedza.strona_od    is 'Numer strony źródła — obowiązkowy, bo opinia sądowa cytuje doktrynę z podaniem strony';
comment on column public.wiedza.techniki     is 'Tagi technik nadawane deterministycznie po słowach kluczowych — dobór musi być odtwarzalny';
