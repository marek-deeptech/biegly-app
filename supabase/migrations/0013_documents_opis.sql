-- Krótki opis dokumentu ustalony Z TREŚCI (po OCR), nie z nazwy pliku.
--
-- POWÓD: w sprawie SKOK (RP I Ds 22.2016) wszystkie 33 dokumenty to skany nazwane
-- przez skaner — `SKM_C451i26080211200.pdf`. Nawet po prawidłowym sklasyfikowaniu
-- („Protokół komitetu") biegły nadal nie wie, KTÓRY to protokół i czy już go czytał;
-- lista akt pozostaje nieczytelna. Jedno zdanie z treści („Protokół nr 7/2014
-- posiedzenia zarządu kasy w sprawie limitów zaangażowania") zmienia listę plików
-- w spis akt.
--
-- Pole jest OPISOWE, nie dowodowe: nie wchodzi do żadnego wyliczenia ani do opinii.
alter table documents add column if not exists opis text;

comment on column documents.opis is
  'Jednozdaniowy opis ustalony z treści dokumentu po OCR. Pomocniczy — nie stanowi podstawy ustaleń.';
