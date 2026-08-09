-- Marbella Collective OS v1.7.2
-- Group existing bookings into guest itineraries.
-- Run once in Supabase > SQL Editor.

begin;

with normalised as (
  select
    id,
    lower(trim(coalesce(nullif(guest_email,''),nullif(regexp_replace(guest_phone,'[^0-9+]','','g'),''),guest_name))) as match_key,
    row_number() over (
      partition by lower(trim(coalesce(nullif(guest_email,''),nullif(regexp_replace(guest_phone,'[^0-9+]','','g'),''),guest_name)))
      order by case when booking_type='villa_stay' then 0 else 1 end, created_at
    ) as rn
  from public.bookings
),
roots as (
  select n.match_key,b.id as root_id,coalesce(b.customer_id,md5(n.match_key)) as customer_id
  from normalised n
  join public.bookings b on b.id=n.id
  where n.rn=1 and n.match_key is not null and n.match_key<>''
)
update public.bookings b
set customer_id=r.customer_id,itinerary_id=r.root_id
from normalised n
join roots r on r.match_key=n.match_key
where b.id=n.id;

commit;
