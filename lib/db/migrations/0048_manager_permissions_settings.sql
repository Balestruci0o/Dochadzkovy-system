-- ============================================================================
-- Granulárne pravomoci manažérov — Fáza 2 (Nastavenia: pozície, šablóny
-- smien, §ZP pravidlá, pokrytie, dni zatvorenia, terminály).
--
-- Čistý is_owner() → has_manager_permission('xxx') swap v 6 WRITE politikách
-- — SCOPING (org_id/workplace_id) SA NEMENÍ, len sa rozširuje KTO môže
-- zapisovať. SELECT politiky sa NEDOTÝKAJÚ — positions/shift_templates/
-- legal_rules/coverage_requirements/workplace_closures majú SELECT otvorený
-- pre KAŽDÉHO prihláseného v organizácii už od 0004/0009 (manažér ich vedel
-- čítať dávno, len naň appka nemala žiadnu obrazovku — layout.tsx blokoval
-- celú /nastavenia sekciu). Jediná výnimka je `terminals`, ktoré doteraz
-- nemalo ŽIADNU manažérsku SELECT politiku vôbec (viď nižšie).
--
-- ROZSAH GRANTU: ORG-ŠIROKÝ, nie len manažérove vlastné prevádzky
-- (manager_workplaces). Dôvod: `legal_rules` nemá workplace_id VÔBEC (§ZP
-- pravidlá sú vlastnosťou CELEJ organizácie, nie prevádzky) — nedalo by sa
-- to inak ani urobiť konzistentne naprieč všetkými piatimi tabuľkami. Balíček
-- je "per manažér, všade rovnako" (zadanie) — raz udelený, platí na CELÚ
-- organizáciu, presne ako to dnes robí owner. Ak by si chcel neskôr per-
-- prevádzkové obmedzenie, je to samostatné rozhodnutie (viď sprievodná
-- správa k tejto fáze).
--
-- VYNECHANÉ ZÁMERNE: `holidays` (sviatky) — zdieľaný SK kalendár BEZ
-- org_id stĺpca (0009 komentár: "nie dáta organizácie") — delegovanie by
-- znamenalo, že manažér JEDNEJ organizácie môže meniť kalendár VŠETKÝCH
-- ostatných organizácií v systéme. Ostáva is_owner()-only NAVŽDY, mimo
-- tohto systému pravomocí (rovnaký duch ako #89 bypass). `workplaces`
-- (prevádzky) — zámerne mimo v1, štruktúrna/org-nastavovacia vec, nie
-- prevádzková delegácia.
-- ============================================================================

DROP POLICY positions_write ON positions;
CREATE POLICY positions_write ON positions FOR ALL USING (
  has_manager_permission('manage_positions_shifts') AND org_id = current_user_org_id()
) WITH CHECK (
  has_manager_permission('manage_positions_shifts') AND org_id = current_user_org_id()
);

DROP POLICY shift_templates_write ON shift_templates;
CREATE POLICY shift_templates_write ON shift_templates FOR ALL USING (
  has_manager_permission('manage_positions_shifts') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  has_manager_permission('manage_positions_shifts') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);

DROP POLICY legal_rules_write ON legal_rules;
CREATE POLICY legal_rules_write ON legal_rules FOR ALL USING (
  has_manager_permission('manage_rules') AND org_id = current_user_org_id()
) WITH CHECK (
  has_manager_permission('manage_rules') AND org_id = current_user_org_id()
);

DROP POLICY coverage_requirements_write ON coverage_requirements;
CREATE POLICY coverage_requirements_write ON coverage_requirements FOR ALL USING (
  has_manager_permission('manage_rules') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  has_manager_permission('manage_rules') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);

DROP POLICY workplace_closures_write ON workplace_closures;
CREATE POLICY workplace_closures_write ON workplace_closures FOR ALL USING (
  has_manager_permission('manage_rules') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  has_manager_permission('manage_rules') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);

-- terminals — pôvodná `terminals_owner` (0009) bola FOR ALL vrátane SELECT,
-- a bola JEDINÁ policy na tejto tabuľke — manažér doteraz nemal ani READ.
-- Nová `terminals_write` (rovnaký FOR ALL tvar, len iná podmienka) mu dá aj
-- READ aj WRITE naraz, presne ako ownerovi dnes.
DROP POLICY terminals_owner ON terminals;
CREATE POLICY terminals_write ON terminals FOR ALL USING (
  has_manager_permission('manage_terminals') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
) WITH CHECK (
  has_manager_permission('manage_terminals') AND workplace_id IN (SELECT id FROM workplaces WHERE org_id = current_user_org_id())
);
