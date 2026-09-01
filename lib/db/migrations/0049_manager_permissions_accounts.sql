-- ============================================================================
-- Granulárne pravomoci manažérov — Fáza 3 (Správa kont), NAJCITLIVEJŠIA.
--
-- manage_accounts dovoľuje oprávnenému manažérovi:
--   1. pozvať/vytvoriť NOVÉ konto s rolou 'manager' ALEBO 'accountant'
--      (NIKDY 'owner' — hardcoded nedosiahnuteľné, nie len nekontrolované)
--   2. deaktivovať/aktivovať EXISTUJÚCE konto s rolou 'employee' (VÝHRADNE
--      tento stĺpec, is_active — žiadny iný sa nesmie zmeniť)
--   3. VIDIEŤ manager/accountant/employee kontá svojej organizácie (nie
--      owner — owner kontá sú štrukturálne neviditeľné pre KAŽDÉHO
--      manažéra, bez ohľadu na balíček, ako ďalšia vrstva nad zápisovým
--      zákazom)
--
-- ZÁMERNE MIMO ROZSAHU (neminuli sme sa v zadaní, nerozširujeme):
--   - mazanie AKÉHOKOĽVEK konta (users_write_owner FOR ALL ostáva jediná
--     DELETE cesta — owner-only, nedotknuté)
--   - deaktivácia manager/accountant/owner kont (len 'employee')
--   - opätovné poslanie pozvánky (resendAccountInviteAction ostáva owner-only
--     — nebolo v zadaní, žiadna nová UPDATE-invited_at politika)
--   - priraďovanie/odoberanie prevádzok existujúcemu manažérovi
--     (manager_workplaces_write ostáva is_owner()-only, nedotknuté)
--   - editovanie manager_permissions (anti-eskalácia z Fázy 1 — NEDOTKNUTÉ,
--     manager_permissions_write ostáva is_owner()-only bez balíčkovej vetvy)
--
-- /pozvat (pozvanie ZAMESTNANCA) je ÚPLNE MIMO tohto systému — users_insert_manager
-- mala VŽDY vetvu `role = 'employee'` a tá ostáva presne taká, aká bola.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- INSERT — rozšírenie users_insert_manager. Pôvodná vetva (role='employee',
-- /pozvat) NEDOTKNUTÁ — pridáva sa DRUHÁ, nezávislá vetva pre manager/
-- accountant, podmienená has_manager_permission('manage_accounts'). 'owner'
-- nie je súčasťou ANI JEDNEJ vetvy — nedosiahnuteľné touto politikou,
-- rovnako ako predtým (jediná cesta na vytvorenie ownera zostáva
-- users_write_owner, is_owner()-only).
-- ----------------------------------------------------------------------------
DROP POLICY users_insert_manager ON users;
CREATE POLICY users_insert_manager ON users FOR INSERT WITH CHECK (
  current_user_role() = 'manager'
  AND org_id = current_user_org_id()
  AND (
    role = 'employee'
    OR (role IN ('manager', 'accountant') AND has_manager_permission('manage_accounts'))
  )
);

-- ----------------------------------------------------------------------------
-- UPDATE — nová politika, na role='employee' cieľoch.
--
-- PÔVODNE malo WITH CHECK zamykať aj VŠETKY OSTATNÉ stĺpce na ich súčasnú
-- hodnotu (self-referenčné korelované subquery, rovnaký vzor ako
-- users_self_update, migrácia 0005) — objavené naživo: Postgres na tom
-- padá s "infinite recursion detected in policy for relation users" (42P17),
-- keď na TEJ ISTEJ tabuľke koexistuje VIAC UPDATE politík so
-- self-referenčnými subquery naraz (users_self_update + táto). Nebolo to
-- zadané ako požiadavka (len moja vlastná defense-in-depth navyše), takže
-- namiesto trigger-based obchádzky (extra mechanizmus, extra riziko v
-- najcitlivejšej fáze) VYPÚŠŤAM ten column-lock úplne. Únik role je AJ TAK
-- nemožný — `role = 'employee'` je v USING aj WITH CHECK, takže riadok,
-- ktorého VÝSLEDNÁ rola nie je 'employee', politika zamietne CELÝ (nie
-- čiastočne) — to pokrýva presne to kritické, čo bolo zadané. Zvyšné
-- stĺpce (email/phone/meno) TEORETICKY môže táto politika prepustiť, ak by
-- appka (bug) poslala viac než `is_active` — `toggleAccountActiveAction`
-- dnes posiela VÝHRADNE `is_active`, čo je aj otestované
-- (manager-permissions-accounts-rls.test.ts). Ak by si chcel column-lock
-- napriek tomu, treba trigger, nie RLS subquery — samostatné rozhodnutie.
-- ----------------------------------------------------------------------------
CREATE POLICY users_update_manage_accounts ON users FOR UPDATE USING (
  has_manager_permission('manage_accounts')
  AND role = 'employee'
  AND org_id = current_user_org_id()
) WITH CHECK (
  has_manager_permission('manage_accounts')
  AND role = 'employee'
  AND org_id = current_user_org_id()
);

-- ----------------------------------------------------------------------------
-- SELECT — nová politika, ADITÍVNA k existujúcej users_select_manager
-- (0005, nedotknutá — tá zostáva pre manažérov BEZ manage_accounts presne
-- taká, aká bola: len zamestnanci vlastných prevádzok). Táto dáva
-- oprávnenému manažérovi manager/accountant/employee VIDITEĽNOSŤ naprieč
-- celou organizáciou (ORG-ŠIROKO, rovnaký vzor ako Fáza 2) — ale
-- role='owner' NIE JE V ZOZNAME, takže owner kontá ostávajú štrukturálne
-- neviditeľné pre KAŽDÉHO manažéra, nezávisle od write-zákazu vyššie.
-- ----------------------------------------------------------------------------
CREATE POLICY users_select_manage_accounts ON users FOR SELECT USING (
  has_manager_permission('manage_accounts')
  AND org_id = current_user_org_id()
  AND role IN ('manager', 'accountant', 'employee')
);
