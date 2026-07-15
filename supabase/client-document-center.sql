-- Tax Savings Planner™ Secure Document Center Version 1.0
-- Run in the Supabase SQL Editor before enabling live document uploads.
-- The browser never connects directly to this table or bucket. The Node server
-- uses SUPABASE_SERVICE_ROLE_KEY after it validates the client's portal session.

create extension if not exists pgcrypto;

create table if not exists public.client_portal_documents (
  document_id uuid primary key default gen_random_uuid(),
  portal_id uuid not null,
  account_lead_id text not null,
  linked_lead_id text,
  email text not null,
  tax_year text not null,
  category text not null,
  original_name text not null,
  storage_path text not null unique,
  content_type text not null,
  extension text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256 text not null,
  note text,
  review_status text not null default 'awaiting-review'
    check (
      review_status in (
        'awaiting-review',
        'in-review',
        'accepted',
        'needs-replacement',
        'withdrawn'
      )
    ),
  client_visible boolean not null default true,
  office_note text,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create index if not exists
  client_portal_documents_portal_uploaded_idx
on public.client_portal_documents (
  portal_id,
  uploaded_at desc
);

create index if not exists
  client_portal_documents_email_tax_year_idx
on public.client_portal_documents (
  lower(email),
  tax_year
);

create unique index if not exists
  client_portal_documents_active_hash_idx
on public.client_portal_documents (
  portal_id,
  tax_year,
  sha256
)
where review_status <> 'withdrawn';

alter table public.client_portal_documents
  enable row level security;

revoke all
on table public.client_portal_documents
from anon, authenticated;

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
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No browser RLS policies are intentionally created. The private Node server
-- is the only document gateway and uses the service-role key after validating
-- the signed HttpOnly portal session. Keep SUPABASE_SERVICE_ROLE_KEY server-only.
