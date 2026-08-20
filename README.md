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


## v3.3.8 — Demo 2 editor cleanup

- Existing bookings now open as one continuous management page rather than a five-step-looking wizard.
- The left-side section navigator is removed when editing an existing booking.
- Guest name remains in the edit title.
- Villa currency symbols now follow the selected booking currency.
- Legacy villa payment strategies are normalised to the new 25% / 50% / 40%-30% plans where possible.
- Technical `Payment stage` is hidden from the normal edit experience.
- Payment summary remains automatic and now includes a **Manage payments** shortcut to the transaction history.
- Adds a proper Supabase password-recovery screen so recovery links let the user choose a new password rather than simply dropping them into the app.
- Includes `api/config.js` so Demo 2 can read the Vercel Supabase environment variables.


## v3.3.9 — Demo 2 payment & itinerary patch

- Corrects 25% villa plans to 25% initial deposit + 25% second deposit + 50% final payment.
- Adds an in-editor action to record the staged/second deposit as paid and automatically promote the booking to the final balance.
- Adds a separate next-payment currency (GBP/EUR), especially for boat balances.
- Adds supplier payment due date; boat bookings default it to the sailing date.
- Departure marina defaults to Puerto Banús with Estepona, Benalmádena and Other; new Other marinas are saved to master resources.
- Fixes itinerary Open buttons and shows linked customer bookings inside the booking editor.
- Adds database fields for next-payment currency and supplier-payment due date, and synchronises the payment-strategy constraint.


## v3.3.10 — Duplicate guard & edit stability

- Customer search now flags **possible duplicate customers** using close-name matching, so names such as “Kellie Beattie” and “Kelly Beattie” are surfaced for review.
- Individual bookings are shown directly beneath each customer result.
- Each booking has a **Delete booking** action with the existing confirmation dialog, making accidental duplicate imports easy to remove without deleting the customer or their other bookings.
- Likely duplicate bookings are marked separately when name, booking type, date and resource strongly overlap.
- Deleting from the customer-search screen keeps the booking wizard open and refreshes the customer results automatically.
- Fixes boat editing so the saved boat name and charter details are re-hydrated after dropdown resources load, preventing the Boat field from reverting to “Select boat”.
- No Supabase migration is required for this update.


## v3.3.12 — Main Bookings duplicate cleanup

- Duplicate detection is now rendered **directly inside the main Bookings card HTML**, rather than relying on a post-render selector.
- Flags **Kelly / Kellie Beattie** style spelling variants.
- Flags shortened legacy identities such as **Grace / Grace Rathbone**.
- Suspected duplicate customer cards with one booking show an immediate **Delete duplicate** button while still collapsed.
- Expanding any itinerary now shows **Delete booking** beside every individual booking, so any unwanted duplicate can be removed from the main Bookings page.
- Delete confirmation still removes only the selected booking.
- No Supabase migration is required.


## v3.3.13 — Duplicate grouping

- Suspected duplicate customers are now sorted into adjacent clusters on the main Bookings page.
- Pairs such as **Grace / Grace Rathbone** and **Kelly / Kellie Beattie** now sit directly one above the other for easy comparison.
- The existing duplicate warning and Delete duplicate controls are unchanged.
- No Supabase migration is required.


## v3.3.14 — Duplicate cluster & delete-button fix

- Fixes duplicate sorting so every suspected duplicate cluster is truly contiguous.
- **Dylan / Dylan Beeson**, **Sophie / Sophie Revell**, **Grace / Grace Rathbone**, and similar matches now sit directly together.
- The more established record in a duplicate pair is shown first where possible.
- Replaces fragile inline delete handlers with a delegated click handler, fixing the **Delete duplicate** and expanded **Delete booking** buttons.
- No Supabase migration is required.


## v3.3.15 — Reliable duplicate actions + Ignore

- Moves duplicate actions out of the clickable booking header so the controls no longer compete with the expand/collapse button.
- **Delete duplicate** now uses a direct, native confirmation flow and then deletes the selected booking.
- Adds **Ignore** beside every suspected duplicate pair.
- Ignore persists in Supabase using `bookings.duplicate_review_ignored`, so reviewed legitimate bookings stop being flagged after refresh.
- Run `supabase/031_duplicate_review_ignore.sql` before testing Ignore.


## v3.3.16 — Ignore duplicate fix

- **Ignore now works immediately** and no longer depends on a Supabase update.
- Ignoring is **pair-specific**: ignoring `Lucy / Lucy Partridge` does not also suppress a separate `Lucy / Lucy Kirk` warning.
- Ignored pairs persist in this browser using local storage and disappear from duplicate clustering immediately.
- No Supabase SQL is required for this patch.


## v3.3.17 — Automatic Archives

- Completed bookings are automatically removed from all live operational views once their final service date is before today.
- Villa stays archive after the **departure date**.
- Boat charters archive after the **sailing date**.
- Private chefs and other services archive after their **event/service date**.
- Archived records no longer appear in Bookings, Dashboard, Daily Operations or Operations Centre.
- Adds a dedicated **Archives** item beneath Bookings in the sidebar.
- Archives can be searched and filtered by booking type, and historic booking records can still be opened.
- Archiving is date-driven; no Supabase migration is required.


## v3.3.18 — Operational times

- Daily Operations and Operations Centre now use the **actual operational time** whenever one is recorded.
- Villa arrivals use the recorded arrival time; villa departures use the recorded departure time.
- Boat sailings use the charter start time.
- Private-chef bookings use the meal/service time where recorded.
- Entertainment and other timed activities use their event/service/start time where available.
- Payment, admin and information tasks remain **All day**.
- Timed items are sorted chronologically within the day; genuine All day items remain grouped first.
- No Supabase migration is required.


## v3.3.19 — Villa payments & operations refinement

This update keeps v3.3.18 as the baseline and adds the latest operational fixes:

- Villa arrivals default to **16:00** and departures to **12:00**, while remaining editable.
- Daily Operations and Operations Centre use those times rather than showing All day.
- Boat, chef and other timed services continue to use their recorded event/start time.
- Guests with a timed event are kept together and prioritised at the top of each day; their items are then ordered chronologically.
- Payment/admin rows remain All day.
- Informational **Payment arrangement** rows are removed from Operations Centre.
- When a staged villa second/further payment is recorded, the next guest payment advances to the final balance and the **supplier amount due becomes that final amount, due 30 days before arrival**.
- Sidebar active-state handling is reset on every view change so Operations Centre cannot remain highlighted after navigation.
- Supabase resource validation now accepts **musician**, allowing suppliers such as Leo the Sax to be added under Musicians.
- Run `supabase/032_villa_payments_operations_resources.sql` once before testing this release.


## v3.3.20 — Duplicate merge + A–Z supplier lists

- Adds **Merge bookings** beside suspected duplicate customer records.
- Clicking Merge on a customer card means **keep that card's guest identity/name** and merge the other suspected duplicate into it.
- All bookings are preserved; their payments, supplier amounts, dates, notes and service details remain attached to their existing booking records.
- The merged bookings receive one customer identity and one itinerary, so they display together as a single guest record.
- Missing contact details on the kept record can be filled from the merged record, while the chosen guest name remains unchanged.
- The existing **Merge matching guests** control remains available for exact email/phone matches.
- Supplier/resource lists now display **A–Z alphabetically**.
- **Other** is always forced to the bottom of its resource list and dropdowns.
- No Supabase SQL migration is required for this update.


## v3.3.21 — villa payment and edit-screen fix
- The existing staged-payment control now persists the **Second deposit paid date**.
- For a 25% / 25% / 50% villa plan, recording the second 25% moves the next guest payment to the final 50%.
- Supplier payment due becomes that final 50% and is due **30 days before arrival**.
- Empty villa concierge sections are hidden when there is no associated booking; populated boat/chef/experience/restaurant sections remain visible.
- **Internal notes stays visible at the bottom.**

Run `supabase/033_second_deposit_paid_date.sql` once before testing the new second-deposit date.


## v3.3.22 — Operations Centre clean-up + Archives styling
- Removes **Booking note** and **Payment note** rows from Operations Centre.
- Internal notes remain available inside the individual booking record.
- Operations Centre remains focused on real operational actions/events such as new bookings, deposits/payments, supplier payments, arrivals/departures and booked services.
- Restores the original Archives card/grid formatting without changing any archive data or archive rules.
- No Supabase SQL is required.


## v3.3.23 — boat timing and date presentation
- Boat final guest payments due on sailing day now inherit the recorded boat start time.
- Boat departure marina defaults to **Puerto Banús** when no marina has been recorded.
- Operational day headers use the full format **Thursday 3rd September 2026**.
- The Daily Operations date selector that defaults to today is shown in **bold**.
- No Supabase SQL is required.


## v3.3.24 — supplier timing + Daily Operations date
- Supplier payments due **on the event/service day** now inherit the event time.
  - Boat supplier payment → boat sailing time.
  - Chef supplier payment → chef/event time.
  - Other timed services → recorded service time.
- If a supplier payment is due on a different date from the event, it remains **All day**.
- Operations Centre day headers now use the full format **Tuesday 25th August 2026**.
- The Daily Operations default/selected date is now explicitly rendered in bold.
- No Supabase SQL is required.


## v3.3.25 — seven targeted fixes
1. Supplier payments due on the event day inherit the linked event time, including chef bookings.
2. Daily Operations selected/today date is bold black.
3. Operations Centre active navigation state is cleared when moving to another screen.
4. Supplier Remove updates immediately without refreshing.
5. Removed suppliers disappear; Restore rows/buttons are no longer shown.
6. Archive guest identity text is right-aligned consistently.
7. Staged villa payments keep a visible Second deposit paid date field even after moving to Final balance; the date is saved with the booking and drives the final supplier amount/date rule.

No Supabase SQL is required because `second_deposit_paid_date` was added previously.


## v3-18 — custom villa further-deposit workflow
- Fixes custom villa payment arrangements such as Kelly Beattie's.
- When a villa is on **Custom arrangement** and the current payment stage is **Further deposit**, the Financial screen now shows:
  - Further deposit amount
  - Further deposit due date
  - **Further deposit paid date**
  - Record further deposit as paid
- Recording that payment creates a payment transaction, saves the paid date, advances the booking to **Final balance**, and recalculates the remaining guest balance.
- Supplier amount due becomes the remaining final balance and defaults to 30 days before arrival.
- The paid date remains visible after the booking advances to Final balance.
- No Supabase SQL is required.


## v3-19 — visible villa further-deposit paid date
- Moves **Further deposit paid date / Second deposit paid date** directly beside the further-deposit due-date area in the Financial section.
- The control no longer sits much farther down the form after supplier/payment fields.
- Works with the v3-18 custom further-deposit logic already added.
- Upload `index.html`, `app.js`, and `styles.css` for this patch.
- No Supabase SQL required.


## v3-20 — first full mobile responsive pass
- Adds a proper mobile viewport.
- Converts the desktop sidebar into a slide-out mobile drawer with backdrop.
- Prevents horizontal scrolling across the console.
- Stacks dashboard, booking, archive, supplier, Daily Operations and Operations Centre layouts for phone screens.
- Makes booking filters and action buttons phone-safe.
- Converts New Booking and edit-booking forms to one-column mobile layouts.
- Makes detail drawers and modals fit within the iPhone viewport.
- Keeps desktop layout unchanged above 820px.
- No Supabase SQL is required.


## v3-21 — mobile pass 2
- Dashboard Add booking button moved to a phone-safe full-width layout.
- Financial summary numbers reduced on mobile for better wrapping.
- Bookings toolbar stacks vertically: search, booking type, merge matching guests, export CSV.
- Booking rows/cards are forced into a one-column phone card layout.
- Daily Operations controls now stack below the heading.
- Suppliers Add new supplier type becomes a full-width mobile action.
- Operations Centre Back to dashboard moves below the intro and filter pills are compacted.
- Desktop layout remains unchanged.
- No Supabase SQL required.

## v3-22 — Marbella Collective brand colours
- Visual-only branding pass based on the supplied Marbella Collective logo.
- Primary buttons, active navigation and key accents now use Marbella Collective coral/orange-red.
- Main navigation uses charcoal for a premium neutral base.
- Backgrounds remain warm cream/off-white with white cards and charcoal text.
- Confirmed/paid/completed states deliberately remain green; due-soon remains amber and overdue remains red so operational meanings stay clear.
- No JavaScript, booking logic or Supabase changes.


## v3-23 — User Activity
- Adds a **User Activity** page to the left navigation.
- The page is visible to **all signed-in Marbella Collective users**, not just an administrator.
- Shows each user's name, email, last login, last seen and an Active now / recent / offline indicator.
- Last seen refreshes while a user is actively using the console.
- Each user may update only their own activity record; all authenticated users may read the full team activity list.
- Run `supabase/034_user_activity.sql` once before deploying/testing this version.


## v3-24 — Boat Save hotfix
- Fixes Save booking failing when creating a boat charter.
- Root cause: staged-villa payment variables were accidentally placed inside the guest-merge function but referenced by the booking save handler.
- Moves those variables into the correct booking-save scope.
- Removes the stray block from Merge matching guests.
- Adds a save error guard so the Save booking button re-enables and displays an error instead of silently appearing stuck.
- No Supabase SQL required.


## v3-25 — Chef + villa testing fixes
- Private Chef event location now pulls the active **Villas** supplier list alphabetically, with **Other** at the bottom.
- Chef final guest payment defaults to the chef event date and is described as cash due on the day.
- Chef supplier payment due date also defaults to the event date.
- Chef supplier currency is fixed to **EUR (€)**.
- Removes the visible **Supplier** and **Assigned chef** fields from Chef & commercial.
- Villa departure date is constrained to the arrival date or later and its picker is anchored to the arrival month/year.
- Villa next-payment currency follows the booking currency automatically.
- For a custom villa booking where the initial deposit is below 50%, the form automatically creates a **Second deposit** stage for the amount needed to reach 50%, shows a second-deposit due-date field and paid-date field, and calculates the remaining 50% final balance.
- No Supabase SQL required.
