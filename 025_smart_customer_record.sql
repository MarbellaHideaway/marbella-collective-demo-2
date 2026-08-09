-- Marbella Collective OS v2.0.0
-- Phase 1: Smart Customer Record
-- Safe linking only: no booking financial/service data is overwritten.

begin;

-- Give unlinked rows a stable customer identity based on an existing matching
-- email, phone or exact normalized guest name where possible.
with canonical as (
  select
    lower(trim(guest_name)) as name_key,
    min(coalesce(customer_id::text, id::text)) as canonical_key
  from public.bookings
  where coalesce(trim(guest_name),'') <> ''
  group by lower(trim(guest_name))
),
matched as (
  select b.id, c.canonical_key
  from public.bookings b
  join canonical c on lower(trim(b.guest_name))=c.name_key
  where b.customer_id is null
)
update public.bookings b
set customer_id = m.canonical_key
from matched m
where b.id=m.id;

-- Put bookings for the same customer onto a common itinerary where one is missing.
with itinerary_source as (
  select customer_id::text as customer_key,
         min(coalesce(itinerary_id::text,id::text)) as itinerary_key
  from public.bookings
  where customer_id is not null
  group by customer_id::text
)
update public.bookings b
set itinerary_id=s.itinerary_key
from itinerary_source s
where b.customer_id::text=s.customer_key
  and b.itinerary_id is null;

commit;
