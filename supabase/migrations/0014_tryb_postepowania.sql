-- Tryb postępowania sprawy: karne albo cywilne.
--
-- POWÓD: wszystkie prompty opinii mówiły „sprawa karna na zlecenie prokuratury"
-- i odsyłały do organu kwalifikację czynu. Sprawa SK Bank (II C 595/23) to
-- powództwo o zapłatę przeciwko UKNF i Bankowi BPS przed sądem cywilnym — opinia
-- w tamtej ramie zastrzegałaby się co do rzeczy, o które nikt nie pyta, a milczała
-- o granicy obowiązującej naprawdę: ocena odpowiedzialności należy do sądu.
--
-- Domyślnie `karne` — cztery sprawy założone wcześniej działają bez zmian.
alter table cases add column if not exists tryb text not null default 'karne';

alter table cases drop constraint if exists cases_tryb_check;
alter table cases add constraint cases_tryb_check check (tryb in ('karne', 'cywilne'));

comment on column cases.tryb is
  'Tryb postępowania: karne | cywilne. Rozstrzyga o adresacie opinii i o granicy kompetencji biegłego.';
