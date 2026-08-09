-- Marbella Collective OS v2.5.2
-- GLOBAL known boat-alias duplicate cleanup
--
-- Known aliases:
--   Big Boat   = Vibe
--   Small Boat = Saxador
--
-- Scope and safety:
-- * Applies to ALL guests.
-- * Only considers boat_charter rows.
-- * Only merges records for the SAME customer and SAME sailing date.
-- * A legacy alias is removed only when the proper canonical boat record also exists.
-- * Canonical financial figures are preserved; duplicate financial values are NOT added.
-- * Missing operational/contact data is copied from the legacy row.
-- * Non-duplicate payment transactions are moved to the canonical row.
-- * Removed rows are written to booking_deletion_log.
-- * Uncertain records are left untouched.

begin;

create table if not exists public.booking_deletion_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid,
  deleted_at timestamptz not null default now(),
  guest_name text,
  booking_type text,
  resource text,
  booking_date date,
  details jsonb not null default '{}'::jsonb
);

do $$
declare
  pair record;
begin
  for pair in
    with boat_rows as (
      select
        b.id,
        b.guest_name,
        b.customer_id,
        b.itinerary_id,
        b.created_at,
        coalesce(bb.charter_date,b.service_date,b.arrival_date) as sail_date,
        lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) as raw_boat,
        case
          when lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) in ('vibe') then 'vibe'
          when lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) in ('big boat','bigboat') then 'vibe'
          when lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) in ('saxador') then 'saxador'
          when lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) in ('small boat','smallboat') then 'saxador'
          else null
        end as canonical_boat,
        case
          when lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) in ('big boat','bigboat','small boat','smallboat') then true
          else false
        end as is_legacy_alias,
        coalesce(
          nullif(trim(b.customer_id),''),
          lower(trim(coalesce(nullif(b.guest_email,''),nullif(regexp_replace(b.guest_phone,'[^0-9+]','','g'),''),b.guest_name)))
        ) as customer_key
      from public.bookings b
      left join public.booking_boats bb on bb.booking_id=b.id
      where b.booking_type='boat_charter'
    ),
    candidates as (
      select
        legacy.id as legacy_id,
        canonical.id as canonical_id,
        legacy.raw_boat as legacy_name,
        canonical.raw_boat as canonical_name,
        canonical.canonical_boat,
        legacy.sail_date,
        legacy.customer_key
      from boat_rows legacy
      join boat_rows canonical
        on canonical.customer_key=legacy.customer_key
       and canonical.sail_date=legacy.sail_date
       and canonical.canonical_boat=legacy.canonical_boat
       and canonical.id<>legacy.id
       and canonical.is_legacy_alias=false
      where legacy.is_legacy_alias=true
        and legacy.canonical_boat is not null
        and canonical.canonical_boat is not null
    )
    select distinct on (legacy_id)
      legacy_id,canonical_id,legacy_name,canonical_name,canonical_boat,sail_date,customer_key
    from candidates
    order by legacy_id,canonical_id
  loop
    -- Preserve useful booking/contact fields only where canonical is blank.
    update public.bookings c
    set
      guest_email = coalesce(nullif(c.guest_email,''),(select nullif(guest_email,'') from public.bookings where id=pair.legacy_id)),
      guest_phone = coalesce(nullif(c.guest_phone,''),(select nullif(guest_phone,'') from public.bookings where id=pair.legacy_id)),
      guest_instagram = coalesce(nullif(c.guest_instagram,''),(select nullif(guest_instagram,'') from public.bookings where id=pair.legacy_id)),
      guest_nationality = coalesce(nullif(c.guest_nationality,''),(select nullif(guest_nationality,'') from public.bookings where id=pair.legacy_id)),
      number_of_guests = coalesce(c.number_of_guests,(select number_of_guests from public.bookings where id=pair.legacy_id)),
      event_location = coalesce(nullif(c.event_location,''),(select nullif(event_location,'') from public.bookings where id=pair.legacy_id)),
      customer_id = coalesce(nullif(c.customer_id,''),(select customer_id from public.bookings where id=pair.legacy_id)),
      itinerary_id = coalesce(c.itinerary_id,(select itinerary_id from public.bookings where id=pair.legacy_id)),
      notes = case
        when coalesce(trim(c.notes),'')='' then (select notes from public.bookings where id=pair.legacy_id)
        when coalesce(trim((select notes from public.bookings where id=pair.legacy_id)),'')='' then c.notes
        when position(trim((select notes from public.bookings where id=pair.legacy_id)) in c.notes)>0 then c.notes
        else c.notes || E'\n' || (select notes from public.bookings where id=pair.legacy_id)
      end
    where c.id=pair.canonical_id;

    -- Preserve boat operational fields, but not duplicate financial values.
    update public.booking_boats c
    set
      charter_date = coalesce(c.charter_date,l.charter_date),
      start_time = coalesce(c.start_time,l.start_time),
      duration_hours = coalesce(c.duration_hours,l.duration_hours),
      departure_marina = coalesce(nullif(c.departure_marina,''),nullif(l.departure_marina,'')),
      guests = coalesce(c.guests,l.guests),
      reference = coalesce(nullif(c.reference,''),nullif(l.reference,'')),
      notes = case
        when coalesce(trim(c.notes),'')='' then l.notes
        when coalesce(trim(l.notes),'')='' then c.notes
        when position(trim(l.notes) in c.notes)>0 then c.notes
        else c.notes || E'\n' || l.notes
      end
    from public.booking_boats l
    where c.booking_id=pair.canonical_id
      and l.booking_id=pair.legacy_id;

    -- Move only payment transactions not already present on canonical.
    update public.booking_payments p
    set booking_id=pair.canonical_id
    where p.booking_id=pair.legacy_id
      and not exists (
        select 1
        from public.booking_payments q
        where q.booking_id=pair.canonical_id
          and q.payment_type=p.payment_type
          and q.payment_date=p.payment_date
          and q.amount=p.amount
          and coalesce(q.currency,'')=coalesce(p.currency,'')
          and coalesce(q.payment_method,'')=coalesce(p.payment_method,'')
      );

    -- Any remaining rows are exact payment duplicates and should not be double counted.
    delete from public.booking_payments
    where booking_id=pair.legacy_id;

    -- Audit legacy record before cascade deletion.
    insert into public.booking_deletion_log
      (booking_id,guest_name,booking_type,resource,booking_date,details)
    select
      b.id,b.guest_name,b.booking_type,
      coalesce(nullif(bb.boat_name,''),b.service_title),
      pair.sail_date,
      jsonb_build_object(
        'reason','Known boat alias duplicate merged globally',
        'alias',pair.legacy_name,
        'canonical_boat',pair.canonical_boat,
        'canonical_booking_id',pair.canonical_id,
        'legacy_total_rental',b.total_rental,
        'legacy_deposit_paid',b.deposit_paid,
        'legacy_next_payment_amount',b.next_payment_amount,
        'legacy_supplier_amount_owed',b.supplier_amount_owed
      )
    from public.bookings b
    left join public.booking_boats bb on bb.booking_id=b.id
    where b.id=pair.legacy_id;

    delete from public.bookings where id=pair.legacy_id;

    -- Normalise canonical display names.
    if pair.canonical_boat='vibe' then
      update public.bookings set service_title='Vibe' where id=pair.canonical_id;
      update public.booking_boats set boat_name='Vibe' where booking_id=pair.canonical_id;
    elsif pair.canonical_boat='saxador' then
      update public.bookings set service_title='Saxador' where id=pair.canonical_id;
      update public.booking_boats set boat_name='Saxador' where booking_id=pair.canonical_id;
    end if;
  end loop;
end $$;

commit;

-- VERIFICATION 1:
-- This should return zero rows if no known alias duplicates remain where the
-- canonical booking is present for the same customer/date.
with boat_rows as (
  select
    b.id,
    b.guest_name,
    coalesce(bb.charter_date,b.service_date,b.arrival_date) as sail_date,
    lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) as raw_boat,
    coalesce(
      nullif(trim(b.customer_id),''),
      lower(trim(coalesce(nullif(b.guest_email,''),nullif(regexp_replace(b.guest_phone,'[^0-9+]','','g'),''),b.guest_name)))
    ) as customer_key
  from public.bookings b
  left join public.booking_boats bb on bb.booking_id=b.id
  where b.booking_type='boat_charter'
)
select *
from boat_rows x
where x.raw_boat in ('big boat','bigboat','small boat','smallboat')
  and exists (
    select 1 from boat_rows y
    where y.customer_key=x.customer_key
      and y.sail_date=x.sail_date
      and (
        (x.raw_boat in ('big boat','bigboat') and y.raw_boat='vibe')
        or
        (x.raw_boat in ('small boat','smallboat') and y.raw_boat='saxador')
      )
  );

-- VERIFICATION 2:
-- Shows any legacy alias rows that were deliberately LEFT ALONE because there
-- was no matching canonical Vibe/Saxador record. These require human review
-- rather than automatic deletion.
select
  b.guest_name,
  coalesce(bb.charter_date,b.service_date,b.arrival_date) as sailing_date,
  coalesce(nullif(bb.boat_name,''),b.service_title) as boat,
  b.total_rental,
  b.deposit_paid,
  b.customer_id,
  b.itinerary_id
from public.bookings b
left join public.booking_boats bb on bb.booking_id=b.id
where b.booking_type='boat_charter'
  and lower(trim(coalesce(nullif(bb.boat_name,''),nullif(b.service_title,''),''))) in ('big boat','bigboat','small boat','smallboat')
order by sailing_date,guest_name;
