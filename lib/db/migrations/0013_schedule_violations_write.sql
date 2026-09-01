-- ============================================================================
-- Blok 9d-2 — nájdené pri prvom reálnom zápise generátora do DB: `schedule_
-- violations` malo od 0001_raw_triggers_rls.sql len `viol_select` (SELECT).
-- Nikdy nedostalo WRITE politiku — dovtedy do neho nikdy nič nezapisovalo
-- (žiadny kód, ani service role cestu nepotreboval). `persistGenerateResult`
-- (Blok 9d-2) zapisuje diery zámerne pod identitou prihláseného
-- owner/manažéra (rovnaká zásada ako 9d-1 pri čítaní — service role len
-- tam, kde to architektúra.md výslovne uvádza), takže bez tejto politiky
-- INSERT vždy zlyhá s "new row violates row-level security policy".
--
-- Rovnaký tvar ako `generation_runs_write` (0004) — scoped cez schedules.workplace_id.
-- ============================================================================

CREATE POLICY schedule_violations_write ON schedule_violations FOR ALL USING (
  is_owner()
  OR (
    current_user_role() = 'manager'
    AND EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_violations.schedule_id
        AND s.workplace_id IN (SELECT accessible_workplaces())
    )
  )
) WITH CHECK (
  is_owner()
  OR (
    current_user_role() = 'manager'
    AND EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id = schedule_violations.schedule_id
        AND s.workplace_id IN (SELECT accessible_workplaces())
    )
  )
);
