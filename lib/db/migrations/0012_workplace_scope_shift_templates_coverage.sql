-- ============================================================================
-- Nájdené pri stavaní DB-loading vrstvy generátora:
-- `shift_templates_select`/`coverage_requirements_select` (migrácia
-- 0009) boli scope-nuté len na ORGANIZÁCIU (current_user_org_id()), nie na
-- PREVÁDZKU. Manažér Office prevádzky preto videl shift_templates aj
-- coverage_requirements Hotela — nekonzistentné s `employees`
-- (`accessible_workplaces()`, zamestnanecká RLS).
--
-- Nie je to únik medzi organizáciami (org_id podmienka tam bola vždy) — je
-- to nekonzistentná izolácia MEDZI prevádzkami tej istej organizácie.
-- `legal_rules` sa ZÁMERNE NEMENÍ — sú to firemné (org-wide) pravidlá, nie
-- prevádzkovo špecifické, zdieľané zámerne.
-- ============================================================================

DROP POLICY IF EXISTS shift_templates_select ON shift_templates;
CREATE POLICY shift_templates_select ON shift_templates FOR SELECT USING (
  is_owner() OR workplace_id IN (SELECT accessible_workplaces())
);

DROP POLICY IF EXISTS coverage_requirements_select ON coverage_requirements;
CREATE POLICY coverage_requirements_select ON coverage_requirements FOR SELECT USING (
  is_owner() OR workplace_id IN (SELECT accessible_workplaces())
);
