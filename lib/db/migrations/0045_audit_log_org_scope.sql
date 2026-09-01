-- ============================================================================
-- Uzavretie medzery z migrácie 0004 (audit_log_select_owner) — vtedajší
-- komentár výslovne hovoril "Kým to nepríde na rad (trigger treba doplniť),
-- owner vidí všetky riadky", teda VŠETKÝCH organizácií, nie len svojej.
-- Migrácia 0043 doplnila `audit_trigger()`, aby `org_id` vypĺňal (pre nové
-- riadky), ale túto politiku neaktualizovala — medzera ostala živá:
-- owner organizácie A si mohol v `/audit` prečítať mená, dovolenky aj
-- pípnutia zamestnancov organizácie B. RLS je primárna obrana a toto
-- vyslovene zakazuje.
--
-- `org_id IS NULL` riadky (historické spred 0043, aj orphaned testovacie
-- dáta bez cascade FK na `organizations`) ostávajú po tejto zmene
-- NEVIDITEĽNÉ pre nikoho — fail-safe, nie fail-open.
-- Vedomý kompromis: stratí sa dohľadateľnosť pár historických riadkov,
-- výmenou za okamžité zatvorenie cross-org úniku.
-- ============================================================================

DROP POLICY audit_log_select_owner ON audit_log;
CREATE POLICY audit_log_select_owner ON audit_log FOR SELECT USING (is_owner() AND org_id = current_user_org_id());
