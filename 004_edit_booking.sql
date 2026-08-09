-- Marbella Collective OS Sprint 3: expanded booking management fields.
-- Safe to run more than once.

alter table public.bookings
  add column if not exists guest_instagram text,
  add column if not exists guest_nationality text,
  add column if not exists adults integer,
  add column if not exists children integer,
  add column if not exists bedrooms_required integer,
  add column if not exists arrival_flight text,
  add column if not exists departure_flight text,
  add column if not exists arrival_airport text,
  add column if not exists departure_airport text,
  add column if not exists commission_rate numeric(6,3) not null default 10,
  add column if not exists damage_deposit numeric(12,2) not null default 0,
  add column if not exists assigned_to text,
  add column if not exists housekeeper text,
  add column if not exists driver text,
  add column if not exists owner_name text;

update public.bookings
set adults = number_of_guests
where adults is null and number_of_guests is not null;
