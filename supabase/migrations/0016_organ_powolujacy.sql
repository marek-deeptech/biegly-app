-- Organ, który powołał biegłego, i data postanowienia.
--
-- POWÓD: gotowy dokument nigdzie nie mówił, kto zlecił opinię. Strona tytułowa
-- niosła sygnaturę i nazwę sprawy, a formuły wstępnej („na zlecenie…") nie było
-- w żadnym trybie. W opinii sądowej to nie jest ozdobnik — z niej wynika podstawa
-- umocowania biegłego i zakres, w jakim się wypowiada.
--
-- Nazwa organu jest w treści postanowienia, ale nie w metadanych sprawy, więc
-- aplikacja nie miała skąd jej wziąć — i nie wolno jej zgadywać.
alter table cases add column if not exists organ text;
alter table cases add column if not exists data_powolania date;

comment on column cases.organ is
  'Organ powołujący biegłego, w pełnym brzmieniu — np. „Sąd Okręgowy w Warszawie", '
  '„Prokuratura Regionalna w Warszawie". Wchodzi do formuły wstępnej opinii.';
comment on column cases.data_powolania is
  'Data postanowienia o powołaniu biegłego / dopuszczeniu dowodu z opinii.';

-- Wartości odczytane z postanowień leżących w aktach.
update cases set organ = 'Sąd Okręgowy w Warszawie', data_powolania = '2025-02-12'
  where name = 'SKOK';
