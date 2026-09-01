-- ============================================================================
-- Granulárne pravomoci manažérov — Fáza 1 (dátový model + has_manager_permission()).
--
-- Balíčky (6, nie mikro-práva): manage_positions_shifts, manage_rules,
-- manage_accounts, view_wages, edit_wages, manage_terminals. "Prístup do
-- Nastavení" je ODVODENÝ (aspoň jeden manage_*-balíček zapnutý) — nemá
-- vlastný stĺpec, viď lib/auth/manager-permissions.ts::hasSettingsAccess.
--
-- ŽIADNY RIADOK = DNEŠNÉ SPRÁVANIE (bezpečná spätná kompatibilita) — táto
-- migrácia NEROBÍ backfill existujúcich manažérov. has_manager_permission()
-- nižšie explicitne ošetruje "riadok neexistuje" ako hardcoded default,
-- ktorý MUSÍ sedieť so stĺpcovými defaultmi vyššie (view_wages=true, zvyšok
-- false) — inak by sa "má riadok so samými defaultmi" a "nemá riadok"
-- rozišli v správaní, čo nesmie nastať.
--
-- TVRDÉ ANTI-ESKALAČNÉ PRAVIDLO (kritické): editovanie
-- TEJTO tabuľky je OWNER-ONLY, bez výnimky, bez ohľadu na akýkoľvek balíček.
-- Manažér nikdy nesmie zmeniť VLASTNÉ ani CUDZIE pravomoci — inak by mohol
-- reťazovo eskalovať (napr. manažér s manage_accounts by si mohol sám pridať
-- edit_wages). manager_permissions_write nižšie je zámerne is_owner() ONLY,
-- žiadna has_manager_permission() vetva. NEROZŠIRUJ toto pravidlo.
--
-- #89 bypass (mazanie zamestnanca s pípnutiami, migrácia 0033) zostáva MIMO
-- tohto systému, owner-only navždy — nemá tu žiadny stĺpec ani vetvu.
-- ============================================================================

CREATE TABLE manager_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  manage_positions_shifts boolean NOT NULL DEFAULT false,
  manage_rules boolean NOT NULL DEFAULT false,
  manage_accounts boolean NOT NULL DEFAULT false,
  view_wages boolean NOT NULL DEFAULT true,
  edit_wages boolean NOT NULL DEFAULT false,
  manage_terminals boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

-- ----------------------------------------------------------------------------
-- has_manager_permission(perm) — JEDINÝ zdroj pravdy pre RLS politiky
-- odteraz (nahrádza is_owner() všade, kde chceme dovoliť aj oprávneného
-- manažéra). is_owner() vždy true (majiteľ má všetko, bez ohľadu na
-- balíčky). Manažér: riadok existuje → daný stĺpec; riadok NEexistuje →
-- hardcoded default (MUSÍ sedieť so stĺpcovými defaultmi vyššie). Iná rola
-- (employee/accountant) → vždy false. STABLE + SECURITY DEFINER — rovnaký
-- vzor ako current_user_role()/accessible_workplaces() (0001/0004), aby
-- funkcia videla manager_permissions riadok nezávisle od RLS na tej tabuľke
-- (inak by sa pri vyhodnocovaní vo write-politike INEJ tabuľky mohla
-- rekurzívne zaseknúť na vlastnom manager_permissions_select).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_manager_permission(perm text) RETURNS boolean AS $$
  SELECT
    is_owner()
    OR (
      current_user_role() = 'manager'
      AND COALESCE(
        (SELECT CASE perm
          WHEN 'manage_positions_shifts' THEN mp.manage_positions_shifts
          WHEN 'manage_rules'            THEN mp.manage_rules
          WHEN 'manage_accounts'         THEN mp.manage_accounts
          WHEN 'view_wages'              THEN mp.view_wages
          WHEN 'edit_wages'              THEN mp.edit_wages
          WHEN 'manage_terminals'        THEN mp.manage_terminals
          ELSE false
        END
        FROM manager_permissions mp WHERE mp.user_id = current_user_id()),
        -- Žiadny riadok → hardcoded default. MUSÍ sedieť so stĺpcovými
        -- defaultmi vyššie (jediný balíček default-true je view_wages).
        perm = 'view_wages'
      )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- RLS na manager_permissions samotnej.
-- ----------------------------------------------------------------------------
ALTER TABLE manager_permissions ENABLE ROW LEVEL SECURITY;

-- Owner vidí pravomoci manažérov VO SVOJEJ organizácii. Manažér vidí VLASTNÝ
-- riadok (transparentnosť — "čo smiem" v budúcom UI), nikdy cudzí.
CREATE POLICY manager_permissions_select ON manager_permissions FOR SELECT USING (
  (is_owner() AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = manager_permissions.user_id AND u.org_id = current_user_org_id()
  ))
  OR user_id = current_user_id()
);

-- ANTI-ESKALÁCIA (viď komentár na začiatku súboru) — zápis VÝHRADNE owner,
-- VŽDY, org-scoped (owner nesmie meniť pravomoci manažéra v CUDZEJ
-- organizácii), a cieľový riadok musí patriť manažérovi (nie sám sebe/inému
-- ownerovi/zamestnancovi/účtovníčke — dátová hygiena, tabuľka dáva zmysel
-- len pre rolu 'manager').
CREATE POLICY manager_permissions_write ON manager_permissions FOR ALL USING (
  is_owner() AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = manager_permissions.user_id AND u.org_id = current_user_org_id() AND u.role = 'manager'
  )
) WITH CHECK (
  is_owner() AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = manager_permissions.user_id AND u.org_id = current_user_org_id() AND u.role = 'manager'
  )
);

-- Audit log — udelenie/odobratie pravomoci sa NESMIE
-- stratiť. Rovnaký vzor ako audit_salary_history (migrácia 0046).
CREATE TRIGGER audit_manager_permissions AFTER INSERT OR UPDATE OR DELETE ON manager_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
