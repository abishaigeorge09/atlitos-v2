-- ATLITOS v2 - 0139_apple_sign_in_tokens.sql
--
-- Apple Guideline 5.1.1(v): an app that offers Sign in with Apple must revoke
-- the user's Apple token when they delete their account, so the app also
-- disappears from Settings, Apple ID, Sign in with Apple on their devices.
-- Launch runbook stage 3.4.
--
-- Revocation needs an Apple REFRESH token, which only exists if we exchanged
-- the one time authorization code Apple hands the app at sign in. The mobile
-- app sends that code to the apple-token-store edge function, which exchanges
-- it at https://appleid.apple.com/auth/token and stores the refresh token
-- here. The delete-account edge function reads it, calls
-- https://appleid.apple.com/auth/revoke, and deletes the row.
--
-- A refresh token is a credential. RLS is on with no policy at all, and anon
-- and authenticated hold no grant: only the service role (the two edge
-- functions) can read or write it. Cascades with the auth user.

create table if not exists public.apple_sign_in_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.apple_sign_in_tokens is
  'Apple refresh token per Sign in with Apple user, kept only so account deletion can revoke it (Guideline 5.1.1(v), 0139). Service role only: no client grant, no RLS policy.';

alter table public.apple_sign_in_tokens enable row level security;
revoke all on public.apple_sign_in_tokens from anon, authenticated;
grant select, insert, update, delete on public.apple_sign_in_tokens to service_role;
