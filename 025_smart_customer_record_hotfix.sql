-- Marbella Collective OS v2.0.1
-- Smart Customer Record SQL hotfix.
-- Preserves UUID type for itinerary_id.
-- Safe to run after the failed v2.0.0 migration.

begin;

-- 1) Give unlinked rows a stable customer identity using an existing matching
-- exact normalized guest name. This does not overwrite any existing customer_id.
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
  join canonical c
    on lower(trim(b.guest_name)) = c.name_key
  where b.customer_id is null
)
update public.bookings b
set customer_id = m.canonical_key
from matched m
where b.id = m.id;

-- 2) For each customer, choose one UUID itinerary root.
-- Prefer an existing itinerary_id; otherwise use the earliest booking id.
with itinerary_source as (
  select
    customer_id::text as customer_key,
    coalesce(
      min(itinerary_id),
      min(id)
    ) as itinerary_uuid
  from public.bookings
  where customer_id is not null
  group by customer_id::text
)
update public.bookings b
set itinerary_id = s.itinerary_uuid
from itinerary_source s
where b.customer_id::text = s.customer_key
  and b.itinerary_id is null;

commit;

-- Verification only: no data changes below this line.
select
  guest_name,
  customer_id,
  itinerary_id,
  count(*) over (partition by customer_id) as linked_bookings
from public.bookings
where customer_id is not null
order by lower(guest_name), coalesce(arrival_date, service_date), created_at;
