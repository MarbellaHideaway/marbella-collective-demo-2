-- Marbella Collective OS v3.0.0
-- Phase 5 final data cleanup
-- Normalises the one remaining known legacy boat alias:
-- Kayla Humphrie, 13 Sep 2026, Small Boat -> Saxador
-- Financials, payments, itinerary and customer links are not changed.

begin;

update public.bookings b
set service_title='Saxador'
where lower(trim(b.guest_name))='kayla humphrie'
  and b.booking_type='boat_charter'
  and coalesce(b.service_date,b.arrival_date)=date '2026-09-13'
  and lower(trim(coalesce(b.service_title,''))) in ('small boat','smallboat');

update public.booking_boats bb
set boat_name='Saxador'
from public.bookings b
where bb.booking_id=b.id
  and lower(trim(b.guest_name))='kayla humphrie'
  and b.booking_type='boat_charter'
  and coalesce(bb.charter_date,b.service_date,b.arrival_date)=date '2026-09-13'
  and lower(trim(coalesce(bb.boat_name,b.service_title,''))) in ('small boat','smallboat');

commit;

-- Verification: should return Saxador, with the same amounts/customer/itinerary.
select
  b.guest_name,
  coalesce(bb.boat_name,b.service_title) as boat,
  coalesce(bb.charter_date,b.service_date) as sailing_date,
  b.total_rental,
  b.deposit_paid,
  b.supplier_amount_owed,
  b.customer_id,
  b.itinerary_id
from public.bookings b
left join public.booking_boats bb on bb.booking_id=b.id
where lower(trim(b.guest_name))='kayla humphrie'
  and b.booking_type='boat_charter'
  and coalesce(bb.charter_date,b.service_date)=date '2026-09-13';
