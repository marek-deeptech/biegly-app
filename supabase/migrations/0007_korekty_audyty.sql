-- 0007 — PĘTLA JAKOŚCI: przechwytywanie poprawek biegłego + audyt opinii.
--
-- Dwie tabele domykające sprzężenie zwrotne aplikacji:
--
-- 1) `korekty` — para PRZED/PO każdej ręcznej edycji prozy rozdziału. Model jest
--    zamrożony i nie uczy się z akt, więc jedynym realnym nośnikiem wiedzy eksperta
--    jest RÓŻNICA między tym, co wygenerował model, a tym, co zatwierdził biegły.
--    Zapis tych par pozwala wstrzykiwać je jako przykłady (few-shot) do kolejnych
--    redakcji — aplikacja „uczy się biegłego" bez trenowania modelu.
--
-- 2) `audyty_opinii` — wynik pracy agenta-audytora: punktacja opinii wobec rubryki
--    (pytania organu odpowiedziane, każda technika z metryką i podstawą prawną,
--    brak sierocych placeholderów). Historia wyników = mierzalny postęp jakości.
--
-- RLS deny-by-default jak w pozostałych tabelach (dostęp tylko uwierzytelnionym).

-- ── 1. Korekty biegłego (sygnał uczenia) ─────────────────────────────────────
create table if not exists public.korekty (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  kind         text not null,          -- rodzaj subanalizy (wash, layering, proza_iii, wnioski…)
  chapter_no   text not null default '',
  przed        text not null,          -- treść wygenerowana przez model
  po           text not null,          -- treść po redakcji biegłego
  zmiana_pct   numeric,                -- skala zmiany (0–100) — do filtrowania drobnych literówek
  uwaga        text,                   -- opcjonalny komentarz biegłego „dlaczego tak"
  aktywna      boolean not null default true,  -- czy używać jako przykład w promptach
  created_at   timestamptz not null default now()
);
create index if not exists korekty_case_idx  on public.korekty(case_id);
create index if not exists korekty_kind_idx  on public.korekty(kind, created_at desc);

alter table public.korekty enable row level security;
drop policy if exists "auth all korekty" on public.korekty;
create policy "auth all korekty" on public.korekty
  for all to authenticated using (true) with check (true);

comment on table  public.korekty            is 'Pary przed/po ręcznej redakcji — sygnał uczenia stylu biegłego (few-shot do promptów)';
comment on column public.korekty.zmiana_pct is 'Procent zmienionej treści; drobne poprawki (<5%) nie są zapisywane';
comment on column public.korekty.aktywna    is 'Wyłącz, by przestać używać danej korekty jako wzorca w promptach';

-- ── 2. Audyty opinii (mierzalna jakość wyjścia) ──────────────────────────────
create table if not exists public.audyty_opinii (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  wynik        integer not null,       -- 0–100, punktacja wobec rubryki
  max_wynik    integer not null default 100,
  ustalenia    jsonb not null default '[]'::jsonb,  -- [{kryterium, status, waga, uwaga}]
  podsumowanie text not null default '',
  model        text,                   -- ID modelu, który przeprowadził audyt (reprodukowalność)
  created_at   timestamptz not null default now()
);
create index if not exists audyty_case_idx on public.audyty_opinii(case_id, created_at desc);

alter table public.audyty_opinii enable row level security;
drop policy if exists "auth all audyty" on public.audyty_opinii;
create policy "auth all audyty" on public.audyty_opinii
  for all to authenticated using (true) with check (true);

comment on table  public.audyty_opinii        is 'Wyniki agenta-audytora opinii — punktacja wobec rubryki, historia = postęp jakości';
comment on column public.audyty_opinii.ustalenia is 'Lista kryteriów z oceną: spelnione | czesciowo | brak, wraz z uzasadnieniem';
