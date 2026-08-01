-- 0011 — WARSTWA TEKSTOWA DOKUMENTU: czy skan został zOCR-owany.
--
-- POWÓD — najgroźniejszy rodzaj błędu, jaki ta aplikacja może popełnić:
-- w sprawie MBR (PO III Ds 84.2020) wgrano 81 dokumentów, raport kompletności
-- pokazał 10/10 wymogów spełnionych, a moduły analizy zieloną listę. Tymczasem
-- DZIEWIĘĆ kluczowych dokumentów — postanowienie o powołaniu biegłego, zawiadomienie
-- UKNF, protokoły komitetu, metodyka limitów, audyt wewnętrzny, BION, uchwały —
-- miało ZERO znaków tekstu na 125 stronach. To były czyste obrazy.
--
-- Aplikacja nie znalazła pytań organu ani podmiotów nie dlatego, że ich nie było,
-- tylko dlatego, że patrzyła na obrazki i nie miała jak o tym powiedzieć. Raport
-- kompletności twierdził, że wszystko jest — i formalnie miał rację, bo plik leżał
-- w aktach. Merytorycznie kłamał.
--
-- Stąd ta kolumna: kompletność akt to nie tylko OBECNOŚĆ pliku, ale też jego
-- CZYTELNOŚĆ. Skan bez warstwy tekstowej ma być brakiem, nie zielonym haczykiem.

alter table public.documents
  add column if not exists warstwa_tekstu text;

-- Wartości: 'jest' (PDF/DOCX z tekstem) | 'brak' (skan do OCR) | 'ocr' (dodana OCR-em)
-- | NULL (nie sprawdzono — dokumenty sprzed tej migracji).
-- Bez ograniczenia CHECK, spójnie z resztą schematu: zbiór wartości pilnuje kod.
create index if not exists documents_warstwa_idx on public.documents(case_id, warstwa_tekstu);

comment on column public.documents.warstwa_tekstu is
  'Czy dokument ma czytelną maszynowo treść: jest | brak (skan wymaga OCR) | ocr (warstwa dodana) | NULL (niesprawdzone). Skan bez warstwy jest dla analizy plikiem pustym — raport kompletności musi to pokazywać jako brak, nie jako spełniony wymóg.';
