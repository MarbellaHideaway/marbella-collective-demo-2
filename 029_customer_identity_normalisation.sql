-- Marbella Collective OS v3.3.0
-- Global customer identity normalisation
--
-- Safe scope:
--   * Exact normalised email match OR exact normalised phone match only.
--   * Does not merge customers solely because their first names match.
--   * Does not delete bookings.
--   * Does not change prices, payments, supplier amounts or booking services.
--   * Normalises customer_id / itinerary_id and uses the fullest known guest name.

begin;

-- Build strong identity groups from exact email matches.
with email_groups as (
  select
    lower(trim(guest_email)) as identity_key,
    min(coalesce(customer_id::text, id::text)) as canonical_customer_id,
    min(coalesce(itinerary_id::text, id::text))::uuid as canonical_itinerary_id
  from public.bookings
  where coalesce(trim(guest_email),'') <> ''
  group by lower(trim(guest_email))
  having count(*) > 1
)
update public.bookings b
set
  customer_id = g.canonical_customer_id,
  itinerary_id = g.canonical_itinerary_id
from email_groups g
where lower(trim(b.guest_email)) = g.identity_key;

-- Exact phone matches for records where email is missing or inconsistent.
with phone_rows as (
  select
    id,
    regexp_replace(coalesce(guest_phone,''),'[^0-9+]','','g') as phone_key,
    customer_id,
    itinerary_id
  from public.bookings
),
phone_groups as (
  select
    phone_key,
    min(coalesce(customer_id::text, id::text)) as canonical_customer_id,
    min(coalesce(itinerary_id::text, id::text))::uuid as canonical_itinerary_id
  from phone_rows
  where phone_key <> ''
  group by phone_key
  having count(*) > 1
)
update public.bookings b
set
  customer_id = g.canonical_customer_id,
  itinerary_id = g.canonical_itinerary_id
from phone_groups g
where regexp_replace(coalesce(b.guest_phone,''),'[^0-9+]','','g') = g.phone_key;

-- Use the fullest known name within each now-linked customer identity.
with ranked_names as (
  select distinct on (customer_id)
    customer_id,
    guest_name
  from public.bookings
  where customer_id is not null
    and coalesce(trim(guest_name),'') <> ''
  order by
    customer_id,
    array_length(regexp_split_to_array(trim(guest_name),'\s+'),1) desc,
    length(trim(guest_name)) desc,
    created_at desc nulls last
)
update public.bookings b
set guest_name = r.guest_name
from ranked_names r
where b.customer_id = r.customer_id
  and coalesce(trim(r.guest_name),'') <> ''
  and b.guest_name is distinct from r.guest_name;

commit;

-- Verification: show linked customer identities that previously carried multiple names.
select
  customer_id,
  array_agg(distinct guest_name order by guest_name) as names,
  array_agg(distinct nullif(trim(guest_email),'') order by nullif(trim(guest_email),'')) filter (where coalesce(trim(guest_email),'')<>'') as emails,
  array_agg(distinct nullif(trim(guest_phone),'') order by nullif(trim(guest_phone),'')) filter (where coalesce(trim(guest_phone),'')<>'') as phones,
  count(*) as booking_records
from public.bookings
where customer_id is not null
group by customer_id
having count(*) > 1
order by booking_records desc, customer_id;
