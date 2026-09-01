-- ============================================================================
-- `coverage_requirements` doteraz nemalo
-- žiadny spôsob, KTORÚ zmenu (ranná/poobedná/nočná) má dané pokrytie
-- obsadiť. Generátor (lib/scheduler/generate.ts, CoverageNeed) potrebuje
-- konkrétny shiftTemplateId/startTime/endTime na KAŽDEJ potrebe pokrytia.
--
-- NULLABLE zámerne (nezadrátovať odhad): reálna dev DB
-- má 2 riadky pokrytia, jeden z nich (Office) patrí prevádzke, ktorá dnes
-- nemá ANI JEDEN shift_template — niet k čomu ho priradiť. Bez väzby
-- generátor toto pravidlo pri načítaní vynechá (viditeľne, nie potichu) a
-- UI ho označí, nech si to majiteľ všimne a dopíše.
-- ============================================================================

ALTER TABLE coverage_requirements
  ADD COLUMN shift_template_id uuid REFERENCES shift_templates(id) ON DELETE SET NULL;
