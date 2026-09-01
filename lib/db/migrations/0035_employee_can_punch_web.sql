-- ============================================================================
-- Web-pípanie tlačidlom (home office) — zamestnanec s ROVNAKÝMI pravidlami
-- ako QR terminál (rate limiting, určenie smeru, zápis do punch_events), len
-- iný vstupný bod (tlačidlo namiesto QR skenu). DEFAULT FALSE — bez tohto
-- súhlasu sa tlačidlo v `moja-dochadzka` vôbec nezobrazí a
-- POST /api/punch/web ho aj tak nezávisle overí.
-- ============================================================================

ALTER TABLE employees
  ADD COLUMN can_punch_web boolean NOT NULL DEFAULT false;
