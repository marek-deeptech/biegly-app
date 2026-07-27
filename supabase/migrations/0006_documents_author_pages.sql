-- 0006 — klasyfikacja dokumentów wg WYTWÓRCY + numery KART AKT.
-- Wprowadzone dla sprawy ZASTAL (akta sądowe TOM I–IX, skany OCR): oprócz typu
-- dokumentu (doc_type) potrzebny drugi wymiar — kto dokument wytworzył/podpisał
-- (KNF / prokuratura / biegły prokuratury (Kozłowski) / sąd / biegły Michrowski / …)
-- oraz zakres kart akt (paginacja z prawego górnego rogu) do nawigacji i odwołań.
-- Wsteczna zgodność: kolumny NULLowalne, nie dotykają HUBTECH/MLM.

alter table public.documents add column if not exists wytworca   text;     -- kod z AUTHORS (lib/intake/taxonomy)
alter table public.documents add column if not exists karta_start integer; -- nr karty akt — początek dokumentu
alter table public.documents add column if not exists karta_end   integer; -- nr karty akt — koniec dokumentu

create index if not exists documents_wytworca_idx on public.documents(case_id, wytworca);
create index if not exists documents_karta_idx    on public.documents(case_id, karta_start);

comment on column public.documents.wytworca    is 'Wytwórca/autor dokumentu (kod AUTHORS) — kto go sporządził/podpisał';
comment on column public.documents.karta_start is 'Nr karty akt (paginacja, prawy górny róg) — początek dokumentu';
comment on column public.documents.karta_end   is 'Nr karty akt — koniec dokumentu (dla dokumentów wielostronicowych)';
