-- 0010 — TYP SPRAWY: druga dziedzina opinii (ryzyko bankowe) w tej samej aplikacji.
--
-- Aplikacja powstała dla manipulacji instrumentami finansowymi, ale ten sam biegły
-- opiniuje też sprawy karne dotyczące zarządzania ryzykiem w bankach (np. PO III Ds
-- 84.2020 — lokata 50 mln zł w Glitnir Bank Hf na trzy tygodnie przed upadkiem
-- islandzkiego sektora). Analiza struktury obu opinii pokazała, że różnią się
-- WYŁĄCZNIE zawartością rozdziału ANALIZA i podstawą prawną — powłoka dokumentu,
-- sposób pisania i model „pytania organu → odpowiedź biegłego" są identyczne.
--
-- ⚠️ DLACZEGO JEDNA APLIKACJA, A NIE KLON:
-- Wszystkie wzorce stylu w tabeli `wzorce` mają dziś rodzaj proza_i / proza_iii /
-- proza_v / wnioski — czyli rozdziały NIEZALEŻNE OD DZIEDZINY. Osobna aplikacja
-- rozcięłaby ten korpus na pół dokładnie wtedy, gdy jest najmniejszy, a mechanizm
-- „jakość rośnie z liczbą spraw" stoi na wolumenie. Opinia bankowa nie potrzebuje
-- własnego korpusu — ona ten korpus powiększa. To samo dotyczy `korekty` i audytora.
--
-- Kolumna ma wartość domyślną, więc trzy istniejące sprawy działają bez zmian.

alter table public.cases
  add column if not exists typ text not null default 'manipulacja_gpw';

-- Świadomie BEZ ograniczenia CHECK na listę wartości: dodanie trzeciej dziedziny
-- (np. sporów kredytowych) ma być zmianą w kodzie, nie migracją bazy. Zbiór
-- dopuszczalnych typów pilnuje rejestr pakietów w lib/domain.
create index if not exists cases_typ_idx on public.cases(typ);

comment on column public.cases.typ is
  'Dziedzina opinii: manipulacja_gpw | ryzyko_bankowe. Wyznacza pakiet dziedzinowy (plan rozdziałów, katalog prawny, taksonomia, wymogi kompletności). Wspólne pozostają: intake, składanie opinii, wzorce stylu, korekty, audytor, wiedza.';
