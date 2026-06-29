-- Akceptacja dokumentu oznaczonego jako wytwór biegłego (zdejmuje czerwoną flagę).
alter table public.documents
  add column if not exists accepted boolean not null default false;
