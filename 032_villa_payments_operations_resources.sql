-- Marbella Collective Demo 2 v3.3.19
-- Operations + villa staged payment + resource type patch

-- Keep villa operational times available on booking rows.
alter table public.bookings
  add column if not exists arrival_time time,
  add column if not exists departure_time time,
  add column if not exists supplier_payment_due_date date;

-- Standard villa defaults for legacy rows that have no explicit time.
update public.bookings
set arrival_time = coalesce(arrival_time, time '16:00'),
    departure_time = coalesce(departure_time, time '12:00')
where coalesce(booking_type,'villa_stay') = 'villa_stay';

-- The UI already contains Musicians. Extend the database constraint to accept
-- the full set of resource categories currently used by Demo 2.
alter table public.master_resources
drop constraint if exists master_resources_resource_type_check;

alter table public.master_resources
add constraint master_resources_resource_type_check
check (
  resource_type in (
    'villa',
    'boat',
    'chef',
    'musician',
    'nightclub',
    'restaurant',
    'beach_club',
    'transfer',
    'decorator',
    'photographer',
    'florist',
    'dj',
    'singer',
    'other_supplier',
    'nationality'
  )
);

comment on column public.bookings.supplier_payment_due_date
is 'Operational due date for the supplier payment.';
