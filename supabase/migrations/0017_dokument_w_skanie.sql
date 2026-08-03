-- Dokument jako FRAGMENT skanu: zakres stron i wskazanie pliku źródłowego.
--
-- POWÓD: skaner produkuje pliki, a nie dokumenty. Jeden `SKM_C451i26080211470.pdf`
-- liczy 54 strony i zawiera uchwałę Zarządu BPS, zarządzenie dyrektora departamentu,
-- metodykę oceny ORAZ osiem kwartalnych ocen sytuacji SK Banku z lat 2012–2014 —
-- dwanaście odrębnych dokumentów akt, każdy z własną datą, wystawcą i numerem karty.
-- Aplikacja liczyła je jako jedną pozycję.
--
-- To nie jest kosmetyka licznika. Biegły cytuje w opinii KONKRETNY dokument
-- („ocena sytuacji ekonomiczno-finansowej SBRiR za III kw. 2014, k. 449"), a nie plik
-- ze skanera. Dopóki dokument nie istnieje jako osobna pozycja, nie da się go
-- zacytować ani sprawdzić jego obecności w wymogach kompletności.
--
-- MODEL: wiersz-dokument wskazuje ten sam `storage_path` co skan, ale ma własny
-- zakres stron i własnego rodzica. Plik zostaje jeden — mnożą się pozycje akt,
-- a nie kopie w magazynie.
alter table documents add column if not exists strona_od integer;
alter table documents add column if not exists strona_do integer;
alter table documents add column if not exists plik_zrodlowy uuid references documents(id) on delete cascade;

comment on column documents.strona_od is
  'Pierwsza strona dokumentu w pliku skanu (1-indeksowana). NULL = dokument zajmuje cały plik.';
comment on column documents.strona_do is
  'Ostatnia strona dokumentu w pliku skanu.';
comment on column documents.plik_zrodlowy is
  'Wiersz skanu, z którego wydzielono ten dokument. NULL = pozycja jest całym plikiem.';

create index if not exists documents_plik_zrodlowy_idx on documents (plik_zrodlowy);

-- Kontrola spójności: zakres stron musi być kompletny i rosnący.
alter table documents drop constraint if exists documents_strony_check;
alter table documents add constraint documents_strony_check check (
  (strona_od is null and strona_do is null)
  or (strona_od is not null and strona_do is not null and strona_od >= 1 and strona_do >= strona_od)
);
