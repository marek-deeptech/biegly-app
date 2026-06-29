-- Subanalizy: edytowalne opracowania cząstkowe biegłego.
-- Opinia montuje się WYŁĄCZNIE z subanaliz o statusie 'zatwierdzona'.
-- RLS deny-by-default: dostęp tylko dla uwierzytelnionych (jak pozostałe tabele).

create table if not exists public.subanalyses (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  kind         text not null,                 -- 'ilosciowa' | 'ekofin' | 'porozumienie' | 'otc'
  chapter_no   text not null,                 -- rozdział opinii, np. 'IV'
  title        text not null,
  status       text not null default 'szkic'
                 check (status in ('szkic','zatwierdzona')),
  body_md      text not null default '',       -- edytowalna proza rozdziału
  data         jsonb not null default '{}'::jsonb,  -- {table, findings, legalRefs} z silnika
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists subanalyses_case_idx on public.subanalyses(case_id);
-- jedna subanaliza danego rodzaju na sprawę (regeneracja = upsert)
create unique index if not exists subanalyses_case_kind_uidx
  on public.subanalyses(case_id, kind);

alter table public.subanalyses enable row level security;
create policy "auth all subanalyses" on public.subanalyses
  for all to authenticated using (true) with check (true);

-- automatyczne odświeżanie updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists subanalyses_touch on public.subanalyses;
create trigger subanalyses_touch before update on public.subanalyses
  for each row execute function public.touch_updated_at();
