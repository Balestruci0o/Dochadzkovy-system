-- ============================================================================
-- Zverejnenie rozvrhu, krok 1 — "zrkadlová" snímka scheduled_shifts, do ktorej
-- sa pri "Zverejniť rozvrh" prekopíruje aktuálny obsah. Zamestnanec (moj-rozvrh)
-- číta VÝHRADNE túto tabuľku, nikdy scheduled_shifts (to je live pracovný
-- návrh manažéra, priebežne prepisovaný aj regeneráciou).
-- ============================================================================

CREATE TABLE "published_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_template_id" uuid,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_employee_id_workplace_id_date_unique" UNIQUE("employee_id","workplace_id","date");
--> statement-breakpoint
CREATE INDEX ON "published_shifts" ("workplace_id","date");
--> statement-breakpoint
CREATE INDEX ON "published_shifts" ("employee_id","date");
--> statement-breakpoint

ALTER TABLE published_shifts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY published_shifts_select ON published_shifts FOR SELECT USING (
  is_owner()
  OR (current_user_role() = 'manager' AND workplace_id IN (SELECT accessible_workplaces()))
  OR employee_id = current_employee_id()
);
--> statement-breakpoint
CREATE POLICY published_shifts_write ON published_shifts FOR ALL USING (
  (is_owner() OR current_user_role() = 'manager')
  AND workplace_id IN (SELECT accessible_workplaces())
);
