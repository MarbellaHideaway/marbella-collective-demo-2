-- Marbella Collective OS v3.2.0
-- Persistent Done actions for Operations Centre.

begin;

create table if not exists public.operational_task_dismissals (
  task_key text primary key,
  booking_id uuid references public.bookings(id) on delete cascade,
  task_type text not null,
  task_date date,
  dismissed_at timestamptz not null default now()
);

create index if not exists operational_task_dismissals_booking_id_idx
  on public.operational_task_dismissals(booking_id);

-- Authenticated Marbella Collective users need normal read/write access.
alter table public.operational_task_dismissals enable row level security;

drop policy if exists "Authenticated users can read operational dismissals"
  on public.operational_task_dismissals;
create policy "Authenticated users can read operational dismissals"
  on public.operational_task_dismissals
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert operational dismissals"
  on public.operational_task_dismissals;
create policy "Authenticated users can insert operational dismissals"
  on public.operational_task_dismissals
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update operational dismissals"
  on public.operational_task_dismissals;
create policy "Authenticated users can update operational dismissals"
  on public.operational_task_dismissals
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete operational dismissals"
  on public.operational_task_dismissals;
create policy "Authenticated users can delete operational dismissals"
  on public.operational_task_dismissals
  for delete
  to authenticated
  using (true);

commit;

select task_key, booking_id, task_type, task_date, dismissed_at
from public.operational_task_dismissals
order by dismissed_at desc;
