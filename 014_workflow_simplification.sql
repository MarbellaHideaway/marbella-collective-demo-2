-- Marbella Collective OS v1.6.5
-- Workflow simplification and nationality master list.
-- Run once in Supabase > SQL Editor.

begin;

alter table public.master_resources
drop constraint if exists master_resources_resource_type_check;

alter table public.master_resources
add constraint master_resources_resource_type_check
check (
  resource_type in (
    'villa','boat','chef','private_chef','entertainment',
    'transfer','airport_transfer','restaurant','beach_club',
    'decorations','shopping','other','nationality'
  )
);

insert into public.master_resources(resource_type,name,sort_order,active)
values
('nationality','British',10,true),
('nationality','Irish',20,true),
('nationality','Spanish',30,true),
('nationality','French',40,true),
('nationality','German',50,true),
('nationality','Dutch',60,true),
('nationality','Belgian',70,true),
('nationality','Italian',80,true),
('nationality','Portuguese',90,true),
('nationality','Swiss',100,true),
('nationality','Swedish',110,true),
('nationality','Norwegian',120,true),
('nationality','Danish',130,true),
('nationality','Finnish',140,true),
('nationality','American',150,true),
('nationality','Canadian',160,true),
('nationality','Australian',170,true),
('nationality','New Zealander',180,true)
on conflict (resource_type,name)
do update set active=true, sort_order=excluded.sort_order;

commit;
