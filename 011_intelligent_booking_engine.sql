-- Marbella Collective OS v1.5: intelligent booking engine
alter table public.bookings add column if not exists commission_type text not null default 'percentage';
alter table public.bookings add column if not exists commission_fixed_amount numeric(12,2);

do $$ begin
  alter table public.bookings add constraint bookings_commission_type_check check (commission_type in ('percentage','fixed'));
exception when duplicate_object then null; end $$;

-- Normalise historic percentage values so 10% is stored as 0.10.
update public.bookings
set commission_rate = commission_rate / 100
where commission_rate > 1;

insert into public.master_resources (resource_type,name,sort_order,active) values
('boat','Vibe',10,true),
('boat','Labrissa',20,true),
('boat','Astondoa',30,true),
('boat','Rodger',40,true),
('boat','Ski Nautique',50,true),
('boat','Cobra Maestro',60,true),
('boat','Other',999,true)
on conflict (resource_type,name) do update set active=true, sort_order=excluded.sort_order;
