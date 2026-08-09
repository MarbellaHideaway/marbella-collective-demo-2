-- Marbella Collective OS v1.8.1
-- Payment strategy and generated payment-position summary.
-- Run once in Supabase > SQL Editor.

begin;

alter table public.bookings
  add column if not exists payment_strategy text not null default 'custom';

alter table public.bookings
  add column if not exists payment_strategy_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_payment_strategy_check'
  ) then
    alter table public.bookings
      add constraint bookings_payment_strategy_check
      check (payment_strategy in ('standard_50_30','staged','fully_paid','pay_later','custom'));
  end if;
end $$;

-- Sensible defaults for existing records without changing their financial figures.
update public.bookings
set payment_strategy = case
  when coalesce(total_rental,0) <= coalesce(deposit_paid,0) then 'fully_paid'
  when lower(trim(coalesce(villa_name,''))) = 'marbella hideaway' then 'standard_50_30'
  else 'custom'
end
where payment_strategy is null or payment_strategy = 'custom';

commit;
