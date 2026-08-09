-- Marbella Collective OS v0.4.2: boat charter operations module.
-- Safe to run more than once. Existing bookings and payments are preserved.

create extension if not exists pgcrypto;

create table if not exists public.booking_boats (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  status text not null default 'not_booked'
    check (status in ('not_booked','enquiry','provisional','confirmed','completed','cancelled')),
  supplier text,
  reference text,
  boat_name text,
  charter_date date,
  start_time time,
  duration_hours numeric(5,2),
  departure_marina text,
  guests integer,
  supplier_cost numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  deposit_paid numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_boats enable row level security;

drop policy if exists "Authenticated users manage booking boats" on public.booking_boats;
create policy "Authenticated users manage booking boats"
on public.booking_boats
for all
to authenticated
using (true)
with check (true);

create or replace function public.set_booking_boat_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_boats_updated_at on public.booking_boats;
create trigger booking_boats_updated_at
before update on public.booking_boats
for each row execute function public.set_booking_boat_updated_at();

insert into public.booking_boats (booking_id,status,guests,notes)
select b.id, case when b.boat_booked then 'confirmed' else 'not_booked' end, b.number_of_guests,
       case when b.boat_booked then 'Imported from the original boat-booked flag during v0.4.2' else null end
from public.bookings b
where not exists (select 1 from public.booking_boats x where x.booking_id=b.id);

create index if not exists booking_boats_booking_id_idx on public.booking_boats(booking_id);
create index if not exists booking_boats_status_idx on public.booking_boats(status);
create index if not exists booking_boats_charter_date_idx on public.booking_boats(charter_date);
