-- Marbella Collective OS v1.6.8
-- Timeline ordering, deposit date override and Concierge synchronisation.
-- Run once in Supabase > SQL Editor.

begin;

alter table public.bookings
  add column if not exists deposit_paid_date date;

-- Prefer the earliest recorded deposit payment date.
update public.bookings b
set deposit_paid_date = coalesce(
  (
    select min(p.payment_date)
    from public.booking_payments p
    where p.booking_id = b.id
      and p.payment_type = 'deposit'
  ),
  b.created_at::date
)
where coalesce(b.deposit_paid,0) > 0
  and b.deposit_paid_date is null;

-- A paid boat deposit means the boat is confirmed.
update public.booking_boats bb
set status = 'confirmed'
from public.bookings b
where bb.booking_id = b.id
  and b.booking_type = 'boat_charter'
  and (
    coalesce(b.deposit_paid,0) > 0
    or exists (
      select 1
      from public.booking_payments p
      where p.booking_id = b.id
        and p.payment_type <> 'refund'
        and p.amount > 0
    )
  )
  and coalesce(bb.status,'not_booked') not in ('completed','confirmed');

commit;
