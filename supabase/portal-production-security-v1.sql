-- Tax Savings Planner™
-- Production Portal Security + Live Private Storage Readiness Version 1.0
--
-- Run this after:
--   supabase/client-portal-foundation.sql
--   supabase/client-document-center.sql
--   supabase/office-document-review-v1.sql
--
-- The Node server must use a server-only Supabase secret key or legacy
-- service-role key. Never place that key in browser JavaScript, public HTML,
-- NEXT_PUBLIC variables, or source control.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Client portal credential table
-- ---------------------------------------------------------------------------

alter table public.client_portal_accounts
  enable row level security;

alter table public.client_portal_accounts
  force row level security;

revoke all
on table public.client_portal_accounts
from public, anon, authenticated;

create unique index if not exists
  client_portal_accounts_portal_id_uidx
on public.client_portal_accounts (portal_id);

create index if not exists
  client_portal_accounts_status_updated_idx
on public.client_portal_accounts (
  status,
  updated_at desc
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'client_portal_accounts_status_check'
  ) then
    alter table public.client_portal_accounts
      add constraint
        client_portal_accounts_status_check
      check (
        status in (
          'pending-activation',
          'active',
          'disabled'
        )
      )
      not valid;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Secure document metadata table
-- ---------------------------------------------------------------------------

alter table public.client_portal_documents
  enable row level security;

alter table public.client_portal_documents
  force row level security;

revoke all
on table public.client_portal_documents
from public, anon, authenticated;

create index if not exists
  client_portal_documents_status_changed_idx
on public.client_portal_documents (
  status_changed_at desc
)
where status_changed_at is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'client_portal_documents_portal_account_fk'
  ) then
    alter table public.client_portal_documents
      add constraint
        client_portal_documents_portal_account_fk
      foreign key (portal_id)
      references public.client_portal_accounts (portal_id)
      on update cascade
      on delete restrict
      not valid;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Private Storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'client-portal-documents',
  'client-portal-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id)
do update set
  public = false,
  file_size_limit =
    excluded.file_size_limit,
  allowed_mime_types =
    excluded.allowed_mime_types;

-- No browser policies are created for the credential table, document table,
-- or private bucket. The Node server is the only gateway and must validate the
-- signed client or office session before using the server-only Supabase key.

-- ---------------------------------------------------------------------------
-- Reliable updated_at timestamps
-- ---------------------------------------------------------------------------

create or replace function
  public.tsp_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all
on function public.tsp_set_updated_at()
from public, anon, authenticated;

drop trigger if exists
  client_portal_accounts_set_updated_at
on public.client_portal_accounts;

create trigger
  client_portal_accounts_set_updated_at
before update
on public.client_portal_accounts
for each row
execute function
  public.tsp_set_updated_at();

drop trigger if exists
  client_portal_documents_set_updated_at
on public.client_portal_documents;

create trigger
  client_portal_documents_set_updated_at
before update
on public.client_portal_documents
for each row
execute function
  public.tsp_set_updated_at();

comment on table public.client_portal_accounts is
  'Server-only portal credentials. No browser role receives table access.';

comment on table public.client_portal_documents is
  'Server-only document metadata for the private Secure Document Center.';
