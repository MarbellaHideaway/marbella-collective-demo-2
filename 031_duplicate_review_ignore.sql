-- Demo 2 v3.3.15
-- Persist a user's decision that a suspected duplicate pair is legitimate.
-- The app marks both sides of a reviewed pair as ignored.

alter table public.bookings
add column if not exists duplicate_review_ignored boolean not null default false;

comment on column public.bookings.duplicate_review_ignored
is 'True when a suspected duplicate customer/booking warning has been reviewed and intentionally ignored.';
