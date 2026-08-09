-- Marbella Collective OS v1.6.3
-- Deposit paid and supplier amount owed
-- Run once in Supabase > SQL Editor.

begin;

alter table public.bookings
  add column if not exists deposit_paid numeric(12,2) not null default 0;

alter table public.bookings
  add column if not exists supplier_amount_owed numeric(12,2) not null default 0;

alter table public.bookings
  add column if not exists supplier_currency text not null default 'GBP';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_supplier_currency_check'
  ) then
    alter table public.bookings
      add constraint bookings_supplier_currency_check
      check (supplier_currency in ('GBP','EUR'));
  end if;
end $$;

update public.bookings b
set deposit_paid = coalesce((
  select sum(case when p.payment_type = 'refund' then -p.amount else p.amount end)
  from public.booking_payments p
  where p.booking_id = b.id
    and p.payment_type = 'deposit'
    and coalesce(p.currency, b.booking_currency, 'GBP') = coalesce(b.booking_currency, 'GBP')
), b.deposit_paid, 0)
where coalesce(b.deposit_paid,0) = 0;

update public.bookings
set supplier_currency = coalesce(booking_currency,'GBP')
where supplier_currency is null
   or supplier_currency not in ('GBP','EUR');

commit;
