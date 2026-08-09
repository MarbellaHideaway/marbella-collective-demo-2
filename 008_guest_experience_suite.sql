-- Marbella Collective OS v1.0 Beta — complete Guest Experience Suite.
-- Flexible service records support decorations, shopping, restaurants, beach clubs and entertainment.

create table if not exists public.booking_experiences (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  service_type text not null check (service_type in ('decorations','shopping','restaurant','beach_club','entertainment')),
  slot integer not null default 1,
  status text not null default 'not_booked',
  title text,
  service_date date,
  service_time time,
  guests integer,
  supplier text,
  contact text,
  reference text,
  supplier_cost numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  details jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, service_type, slot)
);

alter table public.booking_experiences enable row level security;

drop policy if exists "authenticated users can manage booking experiences" on public.booking_experiences;
create policy "authenticated users can manage booking experiences"
on public.booking_experiences for all
to authenticated
using (true)
with check (true);

create index if not exists booking_experiences_booking_idx on public.booking_experiences(booking_id);
create index if not exists booking_experiences_type_idx on public.booking_experiences(service_type);
