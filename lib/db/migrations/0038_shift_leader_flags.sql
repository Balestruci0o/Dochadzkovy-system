-- ============================================================================
-- Vedúci smeny, krok 1 (dátový model) — LEN dva prepínače, generátor sa ich
-- ešte vôbec nedotýka. `positions.requires_shift_leader`: pozícia potrebuje
-- na každý deň PRÁVE JEDNÉHO vedúceho spomedzi už priradených (default vyp).
-- `employees.can_be_shift_leader`: SPÔSOBILOSŤ konkrétneho človeka byť
-- vedúcim (default vyp, napr. brigádnik nikdy) — čistý nezávislý flag, ŽIADNA
-- dedičnosť z pozície (na rozdiel od override_break_tracking_mode).
-- ============================================================================

ALTER TABLE positions
  ADD COLUMN requires_shift_leader boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE employees
  ADD COLUMN can_be_shift_leader boolean NOT NULL DEFAULT false;
