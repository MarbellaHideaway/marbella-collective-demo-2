-- Marbella Collective OS v1.9.0
-- Boat workflow v2 and deletion audit.
-- Run once in Supabase > SQL Editor.

begin;

alter table public.bookings
  add column if not exists deposit_currency text;

update public.bookings
set deposit_currency = coalesce(nullif(deposit_currency,''), nullif(booking_currency,''), 'EUR')
where deposit_currency is null or deposit_currency = '';

-- Boat supplier obligations are always EUR.
update public.bookings
set supplier_currency = 'EUR'
where booking_type = 'boat_charter';

-- Boat final payment is due on the sailing date.
update public.bookings
set next_payment_due_date = service_date
where booking_type = 'boat_charter'
  and service_date is not null;

-- Boat statuses are deliberately simple.
update public.booking_boats
set status = case when status='cancelled' then 'cancelled' else 'confirmed' end;

create table if not exists public.booking_deletion_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid,
  deleted_at timestamptz not null default now(),
  guest_name text,
  booking_type text,
  resource text,
  booking_date date,
  details jsonb not null default '{}'::jsonb
);

commit;
