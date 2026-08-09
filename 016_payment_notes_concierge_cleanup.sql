-- Marbella Collective OS v1.6.7
-- Payment notes and concierge cleanup.
-- Run once in Supabase > SQL Editor.

begin;

alter table public.bookings
  add column if not exists payment_notes text;

alter table public.bookings
  add column if not exists payment_notes_updated_at timestamptz;

commit;
