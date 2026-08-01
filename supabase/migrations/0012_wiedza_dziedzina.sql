-- 0012 — DZIEDZINA ŹRÓDŁA WIEDZY: szczelna separacja repozytoriów.
--
-- POWÓD: repozytorium wiedzy powstało dla jednej dziedziny i dobierało fragmenty
-- wyłącznie po tagu techniki. Po dodaniu drugiej dziedziny to przestaje wystarczać:
-- fragment Prawa bankowego otagowany `ogolne` trafiłby do rozdziału teoretycznego
-- opinii o manipulacji na GPW, a fragment o wash trades — do opinii o ryzyku
-- kredytowym banku. Obie sytuacje są w opinii sądowej niedopuszczalne.
--
-- Wartość `wspolna` istnieje dla materiałów faktycznie ponaddziedzinowych (metodyka
-- opiniowania, k.p.k.) — ale nie jest wartością domyślną. Domyślną jest dziedzina
-- manipulacji, bo wszystkie źródła wprowadzone przed tą migracją jej dotyczą;
-- gdyby domyślną było `wspolna`, cztery istniejące pozycje natychmiast wyciekłyby
-- do spraw bankowych.

alter table public.wiedza_zrodla
  add column if not exists dziedzina text not null default 'manipulacja_gpw';

create index if not exists wiedza_zrodla_dziedzina_idx on public.wiedza_zrodla(dziedzina, aktywne);

comment on column public.wiedza_zrodla.dziedzina is
  'Dziedzina, dla której źródło jest właściwe: manipulacja_gpw | ryzyko_bankowe | wspolna. Dobór fragmentów do promptu MUSI po tym filtrować — inaczej doktryna jednej dziedziny trafia do opinii z drugiej.';
