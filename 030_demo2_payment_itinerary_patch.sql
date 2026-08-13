-- Demo 2 v3.3.9: staged villa payments + boat payment dates/currencies
alter table public.bookings
  add column if not exists next_payment_currency text,
  add column if not exists supplier_payment_due_date date;

update public.bookings
set next_payment_currency = coalesce(next_payment_currency, booking_currency, 'GBP')
where next_payment_currency is null;

update public.bookings b
set supplier_payment_due_date = coalesce(
  b.supplier_payment_due_date,
  bb.charter_date,
  b.service_date,
  b.arrival_date
)
from public.booking_boats bb
where bb.booking_id = b.id
  and b.booking_type = 'boat_charter'
  and b.supplier_payment_due_date is null;

alter table public.bookings
  drop constraint if exists bookings_next_payment_currency_check;
alter table public.bookings
  add constraint bookings_next_payment_currency_check
  check (next_payment_currency is null or next_payment_currency in ('GBP','EUR'));

alter table public.bookings
  drop constraint if exists bookings_payment_strategy_check;
alter table public.bookings
  add constraint bookings_payment_strategy_check
  check (
    payment_strategy is null or payment_strategy in (
      'standard_50_30','staged','fully_paid','pay_later','custom',
      'deposit_25_30','deposit_25_60','deposit_50_30','deposit_50_60',
      'staged_25_25_50','staged_40_30_30','staged_40_30_60'
    )
  );
