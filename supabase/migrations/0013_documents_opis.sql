-- Krótki opis dokumentu ustalony Z TREŚCI (po OCR), nie z nazwy pliku.
--
-- POWÓD: w sprawie SK Banku (II C 595/23) wszystkie 33 wgrane pliki to skany nazwane
-- przez skaner — `SKM_C451i26080211200.pdf`. Nawet po prawidłowym sklasyfikowaniu
-- („Pismo procesowe") biegły nadal nie wie, KTÓRE to pismo, czyje i czy już je czytał;
-- lista akt pozostaje nieczytelna. Jedno zdanie z treści („Odpowiedź na pozew pozwanego
-- ad 2 — Banku Polskiej Spółdzielczości S.A. z 5 maja 2022 r.") zmienia listę plików
-- w spis akt.
--
-- Pole jest OPISOWE, nie dowodowe: nie wchodzi do żadnego wyliczenia ani do opinii.
alter table documents add column if not exists opis text;

comment on column documents.opis is
  'Jednozdaniowy opis ustalony z treści dokumentu po OCR. Pomocniczy — nie stanowi podstawy ustaleń.';
