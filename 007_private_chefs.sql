-- Marbella Collective OS v0.4.3: reusable private chef operations module.
-- Safe to run more than once. Existing bookings, payments and concierge records are preserved.

create extension if not exists pgcrypto;

create table if not exists public.booking_chefs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  status text not null default 'not_booked'
    check (status in ('not_booked','enquiry','awaiting_menu','provisional','confirmed','completed','cancelled')),
  event_type text,
  supplier text,
  chef_name text,
  contact text,
  reference text,
  event_date date,
  event_time time,
  guests integer,
  menu text,
  dietary_requirements text,
  drinks_package text,
  supplier_cost numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  deposit_paid numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_chefs enable row level security;

drop policy if exists "Authenticated users manage booking chefs" on public.booking_chefs;
create policy "Authenticated users manage booking chefs"
on public.booking_chefs
for all
to authenticated
using (true)
with check (true);

create or replace function public.set_booking_chef_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_chefs_updated_at on public.booking_chefs;
create trigger booking_chefs_updated_at
before update on public.booking_chefs
for each row execute function public.set_booking_chef_updated_at();

insert into public.booking_chefs (booking_id,status,guests,notes)
select b.id, case when b.chef_booked then 'confirmed' else 'not_booked' end, b.number_of_guests,
       case when b.chef_booked then 'Imported from the original chef-booked flag during v0.4.3' else null end
from public.bookings b
where not exists (select 1 from public.booking_chefs x where x.booking_id=b.id);

create index if not exists booking_chefs_booking_id_idx on public.booking_chefs(booking_id);
create index if not exists booking_chefs_status_idx on public.booking_chefs(status);
create index if not exists booking_chefs_event_date_idx on public.booking_chefs(event_date);
