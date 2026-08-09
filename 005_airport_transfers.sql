-- Marbella Collective OS v0.4.1: airport transfer operations module.
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.booking_transfers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  status text not null default 'not_booked'
    check (status in ('not_booked','awaiting_details','provisional','confirmed','completed','cancelled')),
  supplier text,
  reference text,
  arrival_flight text,
  arrival_airport text,
  arrival_date date,
  arrival_time time,
  arrival_passengers integer,
  arrival_driver text,
  arrival_vehicle text,
  arrival_pickup_notes text,
  departure_flight text,
  departure_airport text,
  departure_date date,
  departure_pickup_time time,
  departure_passengers integer,
  departure_driver text,
  departure_vehicle text,
  departure_pickup_notes text,
  supplier_cost numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_transfers enable row level security;

drop policy if exists "Authenticated users manage booking transfers" on public.booking_transfers;
create policy "Authenticated users manage booking transfers"
on public.booking_transfers
for all
to authenticated
using (true)
with check (true);

create or replace function public.set_booking_transfer_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_transfers_updated_at on public.booking_transfers;
create trigger booking_transfers_updated_at
before update on public.booking_transfers
for each row execute function public.set_booking_transfer_updated_at();

insert into public.booking_transfers (
  booking_id,status,arrival_flight,arrival_airport,arrival_date,arrival_time,arrival_passengers,
  departure_flight,departure_airport,departure_date,departure_pickup_time,departure_passengers,
  arrival_driver,departure_driver,notes
)
select
  b.id,
  case
    when b.transfer_booked then 'confirmed'
    when coalesce(b.arrival_flight,b.departure_flight,b.flight_details) is not null then 'awaiting_details'
    else 'not_booked'
  end,
  b.arrival_flight,b.arrival_airport,b.arrival_date,b.arrival_time,b.number_of_guests,
  b.departure_flight,b.departure_airport,b.departure_date,b.departure_time,b.number_of_guests,
  b.driver,b.driver,b.flight_details
from public.bookings b
where not exists (select 1 from public.booking_transfers t where t.booking_id=b.id);

create index if not exists booking_transfers_booking_id_idx on public.booking_transfers(booking_id);
create index if not exists booking_transfers_status_idx on public.booking_transfers(status);
