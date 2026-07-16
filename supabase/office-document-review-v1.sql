-- Tax Savings Planner™
-- Secure Office Document Review + Live Storage Readiness Version 1.0
-- Run after supabase/client-document-center.sql on an existing project.

alter table public.client_portal_documents
  add column if not exists client_message text,
  add column if not exists retention_until date,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists status_changed_at timestamptz;

create index if not exists
  client_portal_documents_review_queue_idx
on public.client_portal_documents (
  review_status,
  uploaded_at desc
);

create index if not exists
  client_portal_documents_retention_idx
on public.client_portal_documents (
  retention_until
)
where retention_until is not null;

alter table public.client_portal_documents
  enable row level security;

revoke all
on table public.client_portal_documents
from anon, authenticated;

update storage.buckets
set
  public = false,
  file_size_limit = 15728640,
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]
where id = 'client-portal-documents';

-- Browser users intentionally receive no direct table or bucket policies.
-- The Node server remains the only document gateway and must use the server-only
-- SUPABASE_SERVICE_ROLE_KEY after validating either the client portal session
-- or the signed office document-review session.
