-- ============================================================================
-- OPRAVA: users_self_update (0005) narážal na "infinite recursion detected in
-- policy for relation users" — WITH CHECK obsahoval priamy korelovaný
-- subquery SPÄŤ na users (SELECT ... FROM users u2 WHERE u2.id = users.id),
-- čo núti Postgres znova vyhodnotiť VŠETKY RLS politiky na users (vrátane
-- tejto istej), a to detekuje ako potenciálny cyklus.
--
-- Rovnaký problém by mali is_owner()/current_user_role()/accessible_workplaces()
-- keby neboli SECURITY DEFINER — presne preto sú. Rovnaké riešenie: obalíme
-- prístup k "starému" riadku do SECURITY DEFINER funkcie, ktorá beží ako
-- rola postgres (rolbypassrls), takže sa RLS politiky users nevyhodnocujú
-- znova.
-- ============================================================================

CREATE OR REPLACE FUNCTION stored_user_row(target_id uuid) RETURNS users AS $$
  SELECT * FROM users WHERE id = target_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP POLICY IF EXISTS users_self_update ON users;

CREATE POLICY users_self_update ON users FOR UPDATE USING (
  id = current_user_id()
) WITH CHECK (
  id = current_user_id()
  AND EXISTS (
    SELECT 1 FROM stored_user_row(id) AS old
    WHERE old.org_id = users.org_id
      AND old.auth_user_id IS NOT DISTINCT FROM users.auth_user_id
      AND old.email = users.email
      AND old.role = users.role
      AND old.full_name = users.full_name
      AND old.is_active = users.is_active
      AND old.invited_at IS NOT DISTINCT FROM users.invited_at
      AND old.created_at = users.created_at
  )
);
