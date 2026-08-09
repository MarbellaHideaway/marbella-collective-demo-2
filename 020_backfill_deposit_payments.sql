-- Marbella Collective OS v1.7.2.2
-- Backfill deposit audit entries where a booking shows a deposit but no deposit transaction exists.
-- Run once in Supabase > SQL Editor.

begin;

insert into public.booking_payments (
  booking_id,
  payment_date,
  payment_type,
  amount,
  payment_method,
  reference,
  currency
)
select
  b.id,
  coalesce(b.deposit_paid_date, b.created_at::date, current_date),
  'deposit',
  b.deposit_paid,
  'bank_transfer',
  'Opening payment',
  coalesce(nullif(b.booking_currency,''),'GBP')
from public.bookings b
where coalesce(b.deposit_paid,0) > 0
  and not exists (
    select 1
    from public.booking_payments p
    where p.booking_id = b.id
      and p.payment_type = 'deposit'
  );

commit;
