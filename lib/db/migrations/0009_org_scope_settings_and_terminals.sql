-- ============================================================================
-- Blok 5 (Nastavenia) — dve opravy objavené pri stavaní samoobslužných
-- obrazoviek na presne týchto tabuľkách:
--
-- 1) Politiky z 0004_full_rls_coverage.sql pre "číselníky" (workplaces,
--    positions, shift_templates, workplace_closures, legal_rules,
--    coverage_requirements, organizations) NEBOLI organizačne izolované —
--    `..._select` kontrolovalo len `current_user_id() IS NOT NULL` a
--    `..._write` len `is_owner()`, bez `org_id`/`workplace_id` podmienky.
--    Systém je navrhnutý multi-tenant (schema.sql, riadok 6: "MULTI-TENANT
--    po prevádzkach — izolácia cez RLS, nie cez aplikačnú logiku") — kým je
--    v prevádzke jedna organizácia, nejde o aktívny únik, ale je to presne
--    tá medzera, pred ktorou má chrániť RLS ("ani keby bola chyba v API").
--    Opravujeme teraz, lebo staviame CRUD UI presne nad
--    týmito tabuľkami.
--    `holidays` zostáva bez zmeny — je to zdieľaný SK kalendár (žiadny
--    org_id stĺpec), nie dáta organizácie.
--
-- 2) `terminals` malo RLS zapnuté BEZ jedinej policy (0004, sekcia D) —
--    zámerne, pre Blok 1/2 (prístup len cez adminDb v punch endpointe).
--    Blok 5 pridáva obrazovku "Terminály" pre ownera (registrácia,
--    generovanie tajomstva) — potrebuje vlastnú policy + GRANT pre
--    app_user, scoped len na ownera vo vlastnej organizácii.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_write ON organizations;
CREATE POLICY organizations_write ON organizations FOR ALL USING (
  is_owner() AND id = current_user_org_id()
) WITH CHECK (
  is_owner() AND id = current_user_org_id()
);

-- ---------------------------------------------------------------------------
-- workplaces
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS workplaces_select ON workplaces;
DROP POLICY IF EXISTS workplaces_write ON workplaces;
CREATE POLICY workplaces_select ON workplaces FOR SELECT USING (
  org_id = current_user_org_id()
);
CREATE POLICY workplaces_write ON workplaces FOR ALL USING (
  is_owner() AND org_id = current_user_org_id()
) WITH CHECK (
  is_owner() AND org_id = current_user_org_id()
);

-- ---------------------------------------------------------------------------
-- positions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS positions_select ON positions;
DROP POLICY IF EXISTS positions_write ON positions;
CREATE POLICY positions_select ON positions FOR SELECT USING (
  org_id = current_user_org_id()
);
CREATE POLICY positions_write ON positions FOR ALL USING (
  is_owner() AND org_id = current_user_org_id()
) WITH CHECK (
  is_owner() AND org_id = current_user_org_id()
);

-- ---------------------------------------------------------------------------
-- shift_templates — nemá vlastný org_id, odvodzuje sa cez workplace_id
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shift_templates_select ON shift_templates;
DROP POLICY IF EXISTS shift_templates_write ON shift_templates;
CREATE POLICY shift_templates_select ON shift_templates FOR SELECT USING (
  workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);
CREATE POLICY shift_templates_write ON shift_templates FOR ALL USING (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);

-- ---------------------------------------------------------------------------
-- workplace_closures — tiež len cez workplace_id
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS workplace_closures_select ON workplace_closures;
DROP POLICY IF EXISTS workplace_closures_write ON workplace_closures;
CREATE POLICY workplace_closures_select ON workplace_closures FOR SELECT USING (
  workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);
CREATE POLICY workplace_closures_write ON workplace_closures FOR ALL USING (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);

-- ---------------------------------------------------------------------------
-- legal_rules — má vlastný org_id
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS legal_rules_select ON legal_rules;
DROP POLICY IF EXISTS legal_rules_write ON legal_rules;
CREATE POLICY legal_rules_select ON legal_rules FOR SELECT USING (
  org_id = current_user_org_id()
);
CREATE POLICY legal_rules_write ON legal_rules FOR ALL USING (
  is_owner() AND org_id = current_user_org_id()
) WITH CHECK (
  is_owner() AND org_id = current_user_org_id()
);

-- ---------------------------------------------------------------------------
-- coverage_requirements — len cez workplace_id
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS coverage_requirements_select ON coverage_requirements;
DROP POLICY IF EXISTS coverage_requirements_write ON coverage_requirements;
CREATE POLICY coverage_requirements_select ON coverage_requirements FOR SELECT USING (
  workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);
CREATE POLICY coverage_requirements_write ON coverage_requirements FOR ALL USING (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);

-- ---------------------------------------------------------------------------
-- terminals — nová policy pre ownera (Blok 5: obrazovka "Terminály").
-- Punch endpoint (Blok 7) bude aj tak čítať cez adminDb (HMAC auth, žiadny
-- app.user_id), táto policy je len pre samoobslužnú správu ownerom v appke.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON terminals TO app_user;
CREATE POLICY terminals_owner ON terminals FOR ALL USING (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  is_owner() AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);
