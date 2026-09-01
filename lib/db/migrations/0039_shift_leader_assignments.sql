-- ============================================================================
-- Vedúci smeny, krok 2 — rozhodnutie "kto vedie" pre (workplace, position,
-- date). Vedúci je VŽDY jeden z už priradených na scheduled_shifts tú istú
-- prevádzku/deň (samostatný prechod generátora PO celom mesiaci, viď
-- lib/scheduler/shift-leader.ts) — táto tabuľka len OZNAČUJE, nikdy nemení
-- počet ľudí na smene.
-- ============================================================================

CREATE TABLE "shift_leader_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"date" date NOT NULL,
	"employee_id" uuid,
	"source" "shift_source" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_leader_assignments" ADD CONSTRAINT "shift_leader_assignments_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shift_leader_assignments" ADD CONSTRAINT "shift_leader_assignments_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shift_leader_assignments" ADD CONSTRAINT "shift_leader_assignments_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shift_leader_assignments" ADD CONSTRAINT "shift_leader_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shift_leader_assignments" ADD CONSTRAINT "shift_leader_assignments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shift_leader_assignments" ADD CONSTRAINT "shift_leader_assignments_workplace_id_position_id_date_unique" UNIQUE("workplace_id","position_id","date");
--> statement-breakpoint

ALTER TABLE shift_leader_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shift_leader_assignments_select ON shift_leader_assignments FOR SELECT USING (
  is_owner()
  OR workplace_id IN (SELECT accessible_workplaces())
  OR employee_id = current_employee_id()
);
--> statement-breakpoint
CREATE POLICY shift_leader_assignments_write ON shift_leader_assignments FOR ALL USING (
  (is_owner() OR current_user_role() = 'manager')
  AND workplace_id IN (SELECT accessible_workplaces())
);
