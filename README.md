# Marbella Collective OS — Demo 2

## Version
**v4.0.0-alpha1 — Demo 2 Foundation**

Demo 1 is frozen at **v3.3.6**. Demo 2 continues to use the same existing Supabase database and live booking data; it does not wipe or recreate the database.

## Purpose of Demo 2
Demo 2 is the consolidation and final-testing branch before Live v1.0.

The goal is to stop layering patches onto Demo 1 and instead make the current functionality faster, cleaner and easier to test.

## Alpha 1 changes
- Preserves all v3.3.6 functionality and database compatibility.
- Adds indexed in-memory lookups for payments, boats, chefs, transfers and concierge services.
- Stops repeatedly scanning entire data arrays during common screen rendering.
- Adds a cached canonical Operations Centre feed, invalidated only when data changes or a task is marked Done.
- Reduces repeated de-duplication work when switching Operations Centre filters.
- Adds immediate visual feedback to Open and Done buttons.
- Guards Done actions against accidental double-click / duplicate requests.
- Keeps the current Daily Operations customer/itinerary grouping and duplicate protection.
- Adds visible **Demo 2** labelling.

## Database
**No new Supabase migration is required for Demo 2 Alpha 1.**

Demo 2 deliberately uses the existing database so final testing is performed against the real bookings already entered.

## Release path
Demo 1 v3.3.6 (frozen)
→ Demo 2 v4.x testing
→ final UI/data verification
→ Live v1.0


## v3.3.7 — Villa Booking Payment Workflow

This patch updates the villa booking financial workflow without requiring a database migration.

- Hides the redundant **Opening payments received** field.
- Uses **Deposit paid** as the single initial-payment source of truth.
- Villa deposit date is automatically the booking-created date.
- Adds standard villa payment plans:
  - 50% deposit / balance 30 days before arrival
  - 50% deposit / balance 60 days before arrival
  - 25% deposit / balance 30 days before arrival
  - 25% deposit / balance 60 days before arrival
  - 40% deposit / 30% further instalment / final balance 30 days before arrival
  - 40% deposit / 30% further instalment / final balance 60 days before arrival
- Uses the existing `next_payment_*` fields for the next instalment and `balance_due_date` for the final staged payment, so no schema change is needed.
- Automatically calculates deposit, remaining balance and 30/60-day final payment dates from the selected plan.
- Automatically writes the **Payment summary** from the financial fields; standard villa summaries no longer depend on arrangement notes.
- Shows the guest name in bold beside **Edit Villa Stay** (and the equivalent edit title for other booking types).
- Existing booking/payment data is preserved.
