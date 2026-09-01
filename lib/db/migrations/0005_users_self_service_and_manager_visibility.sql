-- ============================================================================
-- OPRAVA: users_write bol príliš úzky (len owner), čo nútilo appku používať
-- adminDb (service role) na triviálne veci ako "zapíš si vlastný posledný
-- login". A users_select nemal vetvu pre manažéra, čo nútilo duplicate-check
-- pri pozývaní ísť tiež cez adminDb.
--
-- Táto migrácia:
--   1. Nahrádza users_write za users_write_owner (rovnaká sémantika, len
--      premenované, keďže teraz je viac politík na zápis) + users_self_update
--      (bežný používateľ smie meniť LEN last_login_at, activated_at,
--      totp_enabled, totp_secret na vlastnom riadku — nie role/org_id/
--      is_active/email/... — vynútené porovnaním s aktuálnou hodnotou
--      v tabuľke cez subquery).
--   2. Pridáva users_select_manager (manažér vidí users riadky ľudí, ktorí
--      sú zamestnancami v jeho prevádzkach — cez employee_workplaces +
--      accessible_workplaces()).
--   3. Pridáva users_insert_manager (manažér smie založiť users riadok pre
--      NOVÉHO zamestnanca vo svojej organizácii — nikdy pre manažéra/ownera/
--      účtovníčku; to zostáva ownerovi).
-- ============================================================================

DROP POLICY IF EXISTS users_write ON users;

-- Owner: plný CRUD nad všetkými users riadkami vo svojej organizácii
-- (vrátane role/org_id/is_active — to je jediná cesta, ako sa tieto menia).
CREATE POLICY users_write_owner ON users FOR ALL USING (
  is_owner() AND org_id = current_user_org_id()
) WITH CHECK (
  is_owner() AND org_id = current_user_org_id()
);

-- Bežný používateľ: smie UPDATE-núť VLASTNÝ riadok, ale len 4 stĺpce, ktoré
-- appka sama nastavuje (last_login_at pri prihlásení, activated_at po
-- nastavení hesla, totp_enabled/totp_secret pri 2FA). Všetko ostatné musí
-- zostať nezmenené — porovnáva sa s aktuálnou hodnotou v tabuľke, takže
-- pokus zmeniť napr. role sa zamietne (WITH CHECK zlyhá).
CREATE POLICY users_self_update ON users FOR UPDATE USING (
  id = current_user_id()
) WITH CHECK (
  id = current_user_id()
  AND org_id = (SELECT u2.org_id FROM users u2 WHERE u2.id = users.id)
  AND auth_user_id IS NOT DISTINCT FROM (SELECT u2.auth_user_id FROM users u2 WHERE u2.id = users.id)
  AND email = (SELECT u2.email FROM users u2 WHERE u2.id = users.id)
  AND role = (SELECT u2.role FROM users u2 WHERE u2.id = users.id)
  AND full_name = (SELECT u2.full_name FROM users u2 WHERE u2.id = users.id)
  AND is_active = (SELECT u2.is_active FROM users u2 WHERE u2.id = users.id)
  AND invited_at IS NOT DISTINCT FROM (SELECT u2.invited_at FROM users u2 WHERE u2.id = users.id)
  AND created_at = (SELECT u2.created_at FROM users u2 WHERE u2.id = users.id)
);

-- Manažér vidí users riadky zamestnancov vo svojich prevádzkach (nie iných
-- manažérov/účtovníčku — o tých sa nemusí starať a nemá k nim dôvod mať
-- prístup).
CREATE POLICY users_select_manager ON users FOR SELECT USING (
  current_user_role() = 'manager'
  AND EXISTS (
    SELECT 1 FROM employees e
    JOIN employee_workplaces ew ON ew.employee_id = e.id
    WHERE e.user_id = users.id
      AND ew.workplace_id IN (SELECT accessible_workplaces())
  )
);

-- Manažér smie založiť users riadok pre nového zamestnanca vo svojej
-- organizácii (invite flow) — nikdy pre inú rolu, to zostáva ownerovi
-- (users_write_owner).
CREATE POLICY users_insert_manager ON users FOR INSERT WITH CHECK (
  current_user_role() = 'manager'
  AND role = 'employee'
  AND org_id = current_user_org_id()
);
