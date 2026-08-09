-- Marbella Collective OS v1.6: sorting, resource defaults and GBP/EUR support
alter table public.bookings add column if not exists booking_currency text not null default 'GBP';
alter table public.bookings add column if not exists commission_currency text not null default 'GBP';
alter table public.bookings add column if not exists use_resource_commission_default boolean not null default false;
alter table public.booking_payments add column if not exists currency text not null default 'GBP';
alter table public.booking_boats add column if not exists currency text not null default 'EUR';
alter table public.booking_chefs add column if not exists currency text not null default 'EUR';
alter table public.booking_experiences add column if not exists currency text not null default 'EUR';
alter table public.master_resources add column if not exists default_commission_type text;
alter table public.master_resources add column if not exists default_commission_rate numeric(8,6);
alter table public.master_resources add column if not exists default_commission_amount numeric(12,2);
alter table public.master_resources add column if not exists default_commission_currency text;

do $$ begin
  alter table public.bookings add constraint bookings_booking_currency_check check (booking_currency in ('GBP','EUR'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.bookings add constraint bookings_commission_currency_check check (commission_currency in ('GBP','EUR'));
exception when duplicate_object then null; end $$;

-- Marbella Hideaway: always default to zero commission.
update public.master_resources
set default_commission_type='fixed', default_commission_amount=0, default_commission_currency='GBP'
where resource_type='villa' and lower(name)=lower('Marbella Hideaway');

update public.bookings
set commission_type='fixed', commission_fixed_amount=0, commission_currency=booking_currency,
    use_resource_commission_default=true
where booking_type='villa_stay' and lower(coalesce(villa_name,''))=lower('Marbella Hideaway');

-- Chef Davis: default fixed €120 commission. Existing Chef Davis bookings are updated.
insert into public.master_resources(resource_type,name,sort_order,active,default_commission_type,default_commission_amount,default_commission_currency)
values ('chef','Chef Davis',10,true,'fixed',120,'EUR')
on conflict (resource_type,name) do update set
  active=true, default_commission_type='fixed', default_commission_amount=120, default_commission_currency='EUR';

update public.bookings b
set commission_type='fixed', commission_fixed_amount=120, commission_currency='EUR',
    use_resource_commission_default=true
where b.booking_type='private_chef'
  and (lower(coalesce(b.service_title,''))=lower('Chef Davis')
       or exists (select 1 from public.booking_chefs c where c.booking_id=b.id and lower(coalesce(c.chef_name,''))=lower('Chef Davis')));

-- Existing transactions inherit their booking currency where possible.
update public.booking_payments p set currency=b.booking_currency
from public.bookings b where p.booking_id=b.id and p.currency='GBP' and b.booking_currency='EUR';
