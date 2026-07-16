-- Tax Savings Planner™ Secure Client Portal Foundation — Version 1.0
-- Run this once in the Supabase SQL Editor before inviting live clients.
-- The server must use SUPABASE_SERVICE_ROLE_KEY. Never expose that key in a
-- browser, public HTML, NEXT_PUBLIC variable, or client-side JavaScript.

create extension if not exists pgcrypto;

create table if not exists public.client_portal_accounts (
  lead_id text primary key,
  portal_id uuid not null default gen_random_uuid(),
  email text not null,
  status text not null default 'pending-activation',
  password_algorithm text,
  password_iterations integer,
  password_salt text,
  password_hash text,
  session_version integer not null default 0,
  activation jsonb,
  activated_at timestamptz,
  password_updated_at timestamptz,
  last_login_at timestamptz,
  last_activity_at timestamptz,
  setup_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_portal_accounts_email_idx
  on public.client_portal_accounts (lower(email));

alter table public.client_portal_accounts enable row level security;

revoke all on table public.client_portal_accounts from anon;
revoke all on table public.client_portal_accounts from authenticated;

comment on table public.client_portal_accounts is
  'Server-only secure portal credentials. Access with the Supabase service role only.';
