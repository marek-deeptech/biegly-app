-- Idempotentne wgrywanie: jeden wpis dokumentu na (sprawa, ścieżka).

-- 1. Deduplikacja istniejących wierszy (zostaw dokładnie jeden per sprawa+ścieżka).
delete from public.documents a
using public.documents b
where a.ctid < b.ctid
  and a.case_id = b.case_id
  and a.rel_path = b.rel_path;

-- 2. Unikalność → pozwala na upsert (onConflict) przy ponownym wgraniu pliku.
create unique index if not exists documents_case_path_uniq
  on public.documents (case_id, rel_path);
