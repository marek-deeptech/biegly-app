-- Schemat początkowy aplikacji Biegły GPW.
-- Region: UE (ustawiany przy tworzeniu projektu Supabase).
-- RLS deny-by-default: dostęp tylko dla uwierzytelnionych (zespół 2-osobowy).

create extension if not exists "pgcrypto";

-- Sprawa = Zawiadomienie (kontener akt).
create table if not exists public.cases (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  signature   text,                         -- np. 'RP I Ds 4.2019'
  created_at  timestamptz not null default now()
);

-- Sklasyfikowany inwentarz dokumentów (moduł 1-2).
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  rel_path     text not null,
  size_bytes   bigint,
  doc_type     text not null,               -- kod z taksonomii intake
  source       text,
  provenance   text check (provenance in ('wejście','wyjście','?')),
  storage_path text,                         -- lokalizacja w Supabase Storage
  created_at   timestamptz not null default now()
);
create index if not exists documents_case_idx on public.documents(case_id);

-- Wskaźniki silnika faktów (deterministyczne, z walidacją 'co do grosza').
create table if not exists public.metrics (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  key          text not null,               -- np. 'wash_trades_13_10'
  label        text,
  value        numeric,
  target       numeric,                      -- liczba docelowa z opinii (regresja)
  unit         text,                         -- 'szt' | '%' | 'zł'
  session_day  date,
  computed_at  timestamptz not null default now()
);
create index if not exists metrics_case_idx on public.metrics(case_id);

-- Ustalenia walidatora wejścia (QA #1) i recenzenta (QA #2).
create table if not exists public.findings (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases(id) on delete cascade,
  gate        text not null check (gate in ('QA1','QA2')),
  severity    text not null check (severity in ('ERROR','WARN','OK')),
  check_name  text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists findings_case_idx on public.findings(case_id);

-- RLS deny-by-default
alter table public.cases     enable row level security;
alter table public.documents enable row level security;
alter table public.metrics   enable row level security;
alter table public.findings  enable row level security;

create policy "auth all cases"     on public.cases     for all to authenticated using (true) with check (true);
create policy "auth all documents" on public.documents for all to authenticated using (true) with check (true);
create policy "auth all metrics"   on public.metrics   for all to authenticated using (true) with check (true);
create policy "auth all findings"  on public.findings  for all to authenticated using (true) with check (true);

-- Storage: prywatny bucket na wgrane pliki akt (poufne).
insert into storage.buckets (id, name, public)
values ('case-files', 'case-files', false)
on conflict (id) do nothing;

create policy "auth manage case files" on storage.objects
  for all to authenticated
  using (bucket_id = 'case-files')
  with check (bucket_id = 'case-files');
