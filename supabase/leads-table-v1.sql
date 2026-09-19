-- Tax Savings Planner (TM)
-- Leads Table + Production Security Version 1.0
--
-- Run this once in the Supabase SQL Editor before relying on Supabase as the
-- production source of truth for lead/customer/payment/workflow records.
--
-- Safe to run on a clean project (creates the table) or an existing project
-- that already has a "leads" table (only adds missing columns/constraints;
-- never drops or renames anything, never touches existing rows).
--
-- The Node server must use a server-only Supabase secret key or legacy
-- service-role key to read/write this table (see server.js
-- "leadsSupabaseClient"). Never place that key in browser JavaScript, public
-- HTML, NEXT_PUBLIC variables, or source control. All customer/payment/admin
-- access to this table happens server-side only, after the server itself
-- has validated an office session (GET/PATCH /api/leads) or a signed Stripe
-- webhook event -- no browser role is ever granted direct table access.
--
-- Column shape matches exactly what server.js reads/writes today (see
-- appendLead, updateLeadAfterStripePayment, GET/PATCH /api/leads,
-- /api/estimate-summary/:leadId): a handful of top-level scalar columns for
-- fast lookups/ordering, plus the full nested lead/service/payment/workflow
-- record in a single "estimate" jsonb column. "leadId" is intentionally
-- camelCase and double-quoted because the existing JS client already calls
-- .eq("leadId", ...) against this exact column name.
--
-- BEFORE RUNNING ON A PROJECT THAT ALREADY HAS A "leads" TABLE: this script
-- deliberately never weakens the "leadId" uniqueness requirement, so if any
-- existing rows already share a duplicate (non-null) "leadId" value, the
-- CREATE UNIQUE INDEX step below will fail and the migration will stop
-- there (rows with a NULL "leadId" are fine -- the index is scoped to
-- "leadId" is not null, so they never conflict with each other). Run this
-- diagnostic first and resolve any duplicates it reports before executing
-- the rest of this file:
--
--   select "leadId", count(*)
--   from public.leads
--   where "leadId" is not null
--   group by "leadId"
--   having count(*) > 1;
--
-- If your SQL client runs this whole file as one transaction (Supabase's
-- SQL Editor does, by default), a failure here rolls back everything in
-- this script and the pre-existing table is left completely untouched. If
-- you run statements individually instead, a failure at the unique-index
-- step would leave the earlier "alter table add column" statements already
-- applied (additive only -- still no data loss) but RLS/grants further
-- down would not yet be applied; re-run the rest of the script after
-- resolving duplicates.

create extension if not exists pgcrypto;

create table if not exists public.leads (
  "leadId" text primary key,
  name text,
  email text,
  phone text,
  estimate jsonb not null default '{}'::jsonb,
  "taxYear" text,
  "filingYear" text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent for a pre-existing table created by an earlier/ad-hoc setup:
-- add any of these columns only if they are not already present, and never
-- change the type/default of a column that already exists.
alter table public.leads
  add column if not exists "leadId" text,
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists estimate jsonb not null default '{}'::jsonb,
  add column if not exists "taxYear" text,
  add column if not exists "filingYear" text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Ensure "leadId" can uniquely identify a row (primary key if the table was
-- just created above; otherwise a unique index, which is safe to add
-- alongside an existing different primary key without disturbing it).
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'leads'
      and indexname = 'leads_lead_id_uidx'
  ) then
    create unique index leads_lead_id_uidx
      on public.leads ("leadId")
      where "leadId" is not null;
  end if;
end
$$;

create index if not exists leads_created_at_idx
  on public.leads (created_at desc);

create index if not exists leads_email_idx
  on public.leads (lower(email))
  where email is not null;

-- Reliable updated_at timestamps (reuses the trigger function created by
-- supabase/portal-production-security-v1.sql if that migration already ran;
-- creates it here too so this migration is independently runnable).
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

drop trigger if exists leads_set_updated_at on public.leads;

create trigger leads_set_updated_at
before update on public.leads
for each row
execute function public.tsp_set_updated_at();

-- ---------------------------------------------------------------------------
-- Security: server-only access. No browser role (anon/authenticated) may
-- read or write lead/customer/payment records directly, in any environment.
-- The Node server reaches this table only with the service-role key, and
-- only after validating an office session (admin routes) or a verified,
-- signed Stripe webhook event (payment/refund/subscription routes).
-- ---------------------------------------------------------------------------

alter table public.leads enable row level security;
alter table public.leads force row level security;

revoke all
on table public.leads
from public, anon, authenticated;

comment on table public.leads is
  'Server-only customer/lead/payment/workflow records. No browser role receives table access -- all reads/writes happen through the Node server using the Supabase service-role key, after office-session or signed-Stripe-webhook validation.';

comment on column public.leads.estimate is
  'Full nested lead record (contact info, tax data, service sub-objects, payment/workflow state) as JSON. Top-level "leadId"/name/email/phone/"taxYear"/"filingYear" are denormalized copies kept for fast lookups/ordering only -- server.js treats "estimate" as the source of truth for everything else.';
