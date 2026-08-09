-- Marbella Collective OS v1.1 — multi-service booking foundations.
-- Existing records are preserved and classified as villa stays.
-- Safe to run more than once.

alter table public.bookings
  add column if not exists booking_type text,
  add column if not exists service_title text,
  add column if not exists service_date date,
  add column if not exists event_location text;

update public.bookings
set booking_type = 'villa_stay'
where booking_type is null or booking_type = '';

alter table public.bookings
  alter column booking_type set default 'villa_stay';

alter table public.bookings
  alter column booking_type set not null;

-- Standalone services do not require a villa or accommodation dates.
alter table public.bookings alter column villa_name drop not null;
alter table public.bookings alter column arrival_date drop not null;
alter table public.bookings alter column departure_date drop not null;

-- Replace the constraint if this script is rerun or the allowed types evolve.
alter table public.bookings drop constraint if exists bookings_booking_type_check;
alter table public.bookings
  add constraint bookings_booking_type_check
  check (booking_type in (
    'villa_stay','boat_charter','private_chef','entertainment',
    'airport_transfer','decorations','shopping','restaurant',
    'beach_club','other'
  ));

create index if not exists bookings_booking_type_idx on public.bookings(booking_type);
create index if not exists bookings_service_date_idx on public.bookings(service_date);
