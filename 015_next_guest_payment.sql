-- Marbella Collective OS v1.6.6
-- Next guest payment tracking for Marbella Hideaway.
-- Run once in Supabase > SQL Editor.

begin;

alter table public.bookings
  add column if not exists next_payment_amount numeric(12,2) not null default 0;

alter table public.bookings
  add column if not exists next_payment_due_date date;

alter table public.bookings
  add column if not exists next_payment_stage text not null default 'final_balance';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_next_payment_stage_check'
  ) then
    alter table public.bookings
      add constraint bookings_next_payment_stage_check
      check (next_payment_stage in ('final_balance','further_deposit','other'));
  end if;
end $$;

-- Existing Marbella Hideaway bookings:
-- default the next payment to the unpaid booking balance,
-- due 30 days before arrival. Both values remain editable in the app.
update public.bookings
set
  next_payment_amount = greatest(0, coalesce(total_rental,0) - coalesce(deposit_paid,0)),
  next_payment_due_date = arrival_date - 30,
  next_payment_stage = 'final_balance'
where lower(trim(coalesce(villa_name,''))) = 'marbella hideaway'
  and arrival_date is not null
  and coalesce(next_payment_amount,0) = 0;

commit;
