-- ============================================================================
-- Zverejnenie rozvrhu, krok 4 — RLS medzera nájdená pri tejto úprave (mimo
-- pôvodného zadania, ale reálna): `sched_select` doteraz cez
-- `accessible_workplaces()` (tá zahŕňa AJ vlastnú prevádzku zamestnanca cez
-- employee_workplaces) pustila BEŽNÉHO zamestnanca vidieť CELÝ tím prevádzky
-- na `scheduled_shifts` — nielen seba, a bez ohľadu na to, či je rozvrh
-- draft alebo published.
--
-- Odteraz zamestnanec (nie owner, nie manažér) uvidí na `scheduled_shifts`
-- (živý pracovný návrh) VÝHRADNE:
--   1. LEN VLASTNÉ riadky (employee_id = current_employee_id(), nie celý tím)
--   2. LEN keď je patriaci `schedules.status = 'published'`
-- Aplikačne to už teraz nikto takto nečíta (moj-rozvrh/data.ts od tejto
-- zmeny číta `published_shifts`) — toto je druhá (DB) vrstva obrany: RLS je
-- primárna, nie druhá vrstva.
--
-- Owner a manažér BEZ ZMENY — vidia celý tím, draft aj published (to
-- potrebujú na kontrolu/úpravu pred zverejnením).
-- ============================================================================

DROP POLICY IF EXISTS sched_select ON scheduled_shifts;

CREATE POLICY sched_select ON scheduled_shifts FOR SELECT USING (
  is_owner()
  OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
  OR (
    employee_id = current_employee_id()
    AND EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = scheduled_shifts.schedule_id AND s.status = 'published'
    )
  )
);
