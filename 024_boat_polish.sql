-- Marbella Collective OS v1.9.1
-- Boat financial and layout polish.
-- Run once in Supabase > SQL Editor.

begin;

update public.bookings
set booking_currency='EUR'
where booking_type='boat_charter';

update public.bookings
set supplier_currency='EUR'
where booking_type='boat_charter';

update public.bookings
set payment_strategy_notes='Final payment to be paid to Captain on the day.'
where booking_type='boat_charter'
  and (payment_strategy_notes is null or trim(payment_strategy_notes)='');

commit;
