-- ============================================================================
-- Zverejnenie rozvrhu, krok 1 — jednorazový dobeh. `published_shifts`
-- je NOVÁ tabuľka (0040) — v momente jej vzniku je prázdna, aj pre mesiace, ktoré
-- už DÁVNEJŠIE boli `schedules.status = 'published'` (staré "Zverejniť rozvrh"
-- pred touto zmenou len prepínalo status, nič nekopírovalo — published_shifts
-- vtedy ešte neexistovala). Bez tohto dobehu by zamestnanec pri nasadení tejto
-- zmeny NA CHVÍĽU videl PRÁZDNY kalendár aj za mesiace, ktoré manažér reálne
-- už zverejnil — presný opak zámeru ("zamestnanci vidia POSLEDNÝ zverejnený
-- rozvrh"). Doplní snímku PRESNE raz, len tam, kde ešte žiadna neexistuje
-- (ON CONFLICT DO NOTHING — needuplikuje, ak by 0040/0041 bežali opakovane
-- alebo ak medzitým niekto už klikol "Zverejniť" ručne).
-- ============================================================================

INSERT INTO published_shifts (
  schedule_id, employee_id, workplace_id, date,
  shift_template_id, start_time, end_time, break_minutes, crosses_midnight,
  published_by
)
SELECT
  ss.schedule_id, ss.employee_id, ss.workplace_id, ss.date,
  ss.shift_template_id, ss.start_time, ss.end_time, ss.break_minutes, ss.crosses_midnight,
  NULL
FROM scheduled_shifts ss
JOIN schedules s ON s.id = ss.schedule_id
WHERE s.status = 'published'
ON CONFLICT (employee_id, workplace_id, date) DO NOTHING;
