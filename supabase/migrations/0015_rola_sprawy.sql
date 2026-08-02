-- Rola procesowa sprawy: czyje zachowanie jest przedmiotem oceny.
--
-- POWÓD: cała warstwa bankowa miała zaszyte domyślne ustawienie pierwszej sprawy
-- (MBR) — „badamy bank oceniający kontrahenta". W sprawie SK Banku (II C 595/23),
-- gdzie pozwanym jest organ nadzoru, dawało to trzy niezależne skutki:
--   • wniosek do sądu prosił o spready CDS „ocenianego kontrahenta" — dla banku
--     spółdzielczego materiał, który nie istnieje;
--   • rozdział z kwotami odczytanymi z harmonogramu UKNF nosił tytuł „Analiza
--     sprawozdań finansowych kontrahenta";
--   • brak metodyki limitów banku był wykazywany jako brak KRYTYCZNY, czyli raport
--     twierdził, że opinii w ogóle nie da się wydać.
--
-- Trzecia oś obok `typ` (co się bada) i `tryb` (komu biegły odpowiada).
--
-- Domyślnie `ocena_kontrahenta` — sprawy założone wcześniej działają bez zmian,
-- w tym gotowa opinia MBR.
alter table cases add column if not exists rola text not null default 'ocena_kontrahenta';

alter table cases drop constraint if exists cases_rola_check;
alter table cases add constraint cases_rola_check
  check (rola in ('ocena_kontrahenta', 'nadzor_nad_bankiem', 'organy_banku'));

comment on column cases.rola is
  'Rola procesowa: ocena_kontrahenta | nadzor_nad_bankiem | organy_banku. '
  'Rozstrzyga, które dokumenty są dla opinii krytyczne, jak nazywać podmiot badany '
  'i jaki tytuł nosi rozdział o wielkościach finansowych.';

-- Sprawa SK Banku: pozwanymi są UKNF i Bank BPS, przedmiotem oceny nadzór nad bankiem.
update cases set rola = 'nadzor_nad_bankiem' where name = 'SKOK';
