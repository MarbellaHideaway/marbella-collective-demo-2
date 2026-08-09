-- Marbella Collective OS v1.7.1
-- Linked customers and multi-boat itineraries.
-- Run once in Supabase > SQL Editor.

begin;

alter table public.bookings add column if not exists customer_id text;
alter table public.bookings add column if not exists itinerary_id uuid;

update public.bookings
set customer_id = md5(lower(trim(coalesce(nullif(guest_email,''),nullif(regexp_replace(guest_phone,'[^0-9+]','','g'),''),guest_name,id::text))))
where customer_id is null or trim(customer_id) = '';

update public.bookings set itinerary_id = id where itinerary_id is null;

create index if not exists bookings_customer_id_idx on public.bookings(customer_id);
create index if not exists bookings_itinerary_id_idx on public.bookings(itinerary_id);

commit;
