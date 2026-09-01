-- ============================================================================
-- "Chýba mi pípnutie" — zamestnanec žiada PRIDANIE úplne chýbajúceho pípnutia
-- (terminál nešiel, appka spadla — žiadny punch_events záznam vôbec
-- neexistuje). Samostatná tabuľka od `punch_correction_requests` (tá opravuje
-- EXISTUJÚCE razítko/deň) — odkazuje priamo na employee_id+workplace_id+date,
-- NIE attendance_day_id, lebo pre úplne vynechaný deň žiadny attendance_days
-- riadok ešte nemusí existovať (vzniká lenivo, až pri prvom pípnutí).
--
-- RLS rovnaký tvar ako punch_correction_requests (migrácia 0004) — zamestnanec
-- žiada vlastné, manažér/owner vidí a rozhoduje podľa accessible_workplaces().
-- Jednoduchšie než pri punch_correction_requests: workplace_id je PRIAMO na
-- riadku, netreba EXISTS cez attendance_days.
-- ============================================================================

CREATE TABLE "missing_punch_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"date" date NOT NULL,
	"direction" "punch_direction" NOT NULL,
	"kind" "punch_kind" DEFAULT 'zmena' NOT NULL,
	"requested_time" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "missing_punch_requests" ADD CONSTRAINT "missing_punch_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "missing_punch_requests" ADD CONSTRAINT "missing_punch_requests_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "missing_punch_requests" ADD CONSTRAINT "missing_punch_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX ON "missing_punch_requests" ("employee_id", "date");
--> statement-breakpoint

ALTER TABLE missing_punch_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY missing_punch_requests_select ON missing_punch_requests FOR SELECT USING (
  is_owner()
  OR employee_id = current_employee_id()
  OR workplace_id IN (SELECT accessible_workplaces())
);
--> statement-breakpoint
CREATE POLICY missing_punch_requests_insert ON missing_punch_requests FOR INSERT WITH CHECK (
  is_owner() OR employee_id = current_employee_id()
);
--> statement-breakpoint
CREATE POLICY missing_punch_requests_update ON missing_punch_requests FOR UPDATE USING (
  is_owner()
  OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
);
