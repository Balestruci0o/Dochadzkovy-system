-- ============================================================================
-- Nová funkcia: pípanie prestávok, krok 3 — druhý QR kód (Terminál). `kind`
-- je ORTOGONÁLNY k `direction` (in/out), nie rozšírenie jeho hodnôt: "zmena"
-- = doterajší príchod/odchod (default, zachováva presne dnešné správanie),
-- "prestavka" = nová dvojica razítok (odchod/príchod z prestávky).
-- ============================================================================

CREATE TYPE "public"."punch_kind" AS ENUM('zmena', 'prestavka');--> statement-breakpoint
ALTER TABLE "punch_events" ADD COLUMN "kind" "punch_kind" DEFAULT 'zmena' NOT NULL;
