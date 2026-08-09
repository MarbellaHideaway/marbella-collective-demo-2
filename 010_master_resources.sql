-- Marbella Collective OS v1.2: master data for villas and boats.
create table if not exists public.master_resources (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('villa','boat')),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(resource_type, name)
);

alter table public.master_resources enable row level security;

drop policy if exists "authenticated users can manage master resources" on public.master_resources;
create policy "authenticated users can manage master resources"
on public.master_resources for all
to authenticated
using (true)
with check (true);

insert into public.master_resources (resource_type,name,sort_order) values
('villa','Marbella Hideaway',10),
('villa','Villa Vanilla',20),
('villa','Villa Monterey',30),
('villa','Villa V',40),
('villa','Villa Ampola',50),
('boat','Labrissa',10),
('boat','Vibe',20),
('boat','Cobra',30),
('boat','Swederm',40),
('boat','Other',999)
on conflict (resource_type,name) do update set active=true, sort_order=excluded.sort_order;
