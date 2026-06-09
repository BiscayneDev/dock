-- Lock down recipe_payments writes.
-- The table had public INSERT (WITH CHECK true) and UPDATE (USING true)
-- policies, letting anyone with the anon key forge or mutate payment rows
-- (e.g. mark a recipe paid without paying). All legitimate writes happen
-- server-side via the service-role client (process-payment, x402/server),
-- which bypasses RLS — so dropping these policies removes anon/authenticated
-- write access with no impact on the app. The owner-scoped SELECT policy
-- (payments_visible_to_involved) is intentionally kept.
drop policy if exists payments_insert on recipe_payments;
drop policy if exists payments_update on recipe_payments;
