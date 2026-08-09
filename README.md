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
