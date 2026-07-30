-- 0008 — KORPUS WZORCÓW STYLU: rozdziały historycznych opinii biegłego.
--
-- Cel: aplikacja pisze prozę w stylu biegłego, ucząc się z jego WŁASNYCH wcześniejszych
-- opinii. Model nie jest douczany (fine-tuning Claude'a nie istnieje) — wzorce trafiają
-- do promptu jako przykłady, dobierane per rozdział. Im więcej opinii w korpusie, tym
-- lepsze dopasowanie: to jedyny mechanizm, w którym jakość prozy realnie rośnie z liczbą spraw.
--
-- ⚠️ ZASADA EVIDENCE-ONLY — TWARDO WYEGZEKWOWANA SCHEMATEM:
-- Przechowujemy WYŁĄCZNIE treść ZSZKIELETYZOWANĄ (bez nazwisk, nazw podmiotów, liczb,
-- dat i sygnatur — zastąpionych znacznikami ⟨PODMIOT⟩, ⟨liczba⟩, ⟨data⟩). Surowa treść
-- NIE jest zapisywana w bazie. Dzięki temu przeniesienie faktu z cudzej/starszej sprawy
-- do nowej opinii jest strukturalnie niemożliwe — wzorzec niesie sposób pisania, nie treść.
-- Jeśli szkieletyzator zostanie ulepszony, korpus buduje się ponownie z plików źródłowych.

create table if not exists public.wzorce (
  id           uuid primary key default gen_random_uuid(),
  autor        text not null default 'KM',   -- autor opinii wzorcowej (spójność stylu)
  sprawa       text not null,                -- etykieta sprawy źródłowej (do audytu pochodzenia)
  plik         text not null,                -- nazwa pliku źródłowego
  rozdzial_no  text not null default '',     -- 'I', 'II', 'IV.4' …
  rodzaj       text not null,                -- kind rozdziału: wash | layering | wnioski | proza_iii …
  tytul        text not null default '',
  szkielet     text not null,                -- TREŚĆ ZSZKIELETYZOWANA (jedyna przechowywana forma)
  znakow       integer not null default 0,   -- długość oryginału (do doboru wzorca o podobnej skali)
  aktywny      boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists wzorce_rodzaj_idx on public.wzorce(rodzaj, aktywny);
create index if not exists wzorce_autor_idx  on public.wzorce(autor);

-- jeden wzorzec na (plik, rozdział) — ponowny ingest nadpisuje, nie duplikuje
create unique index if not exists wzorce_plik_rozdzial_uidx
  on public.wzorce(plik, rozdzial_no, rodzaj);

alter table public.wzorce enable row level security;
drop policy if exists "auth all wzorce" on public.wzorce;
create policy "auth all wzorce" on public.wzorce
  for all to authenticated using (true) with check (true);

comment on table  public.wzorce          is 'Rozdziały historycznych opinii biegłego — WYŁĄCZNIE w postaci zszkieletyzowanej; wzorzec stylu, nigdy źródło faktów';
comment on column public.wzorce.szkielet is 'Treść po usunięciu nazwisk, liczb, dat i sygnatur — surowej treści świadomie NIE przechowujemy';
comment on column public.wzorce.znakow   is 'Długość oryginalnego rozdziału — do doboru wzorca o zbliżonej skali';
