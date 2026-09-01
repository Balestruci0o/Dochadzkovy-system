-- ============================================================================
-- Blok 15 (Vrstva C, robené po častiach) — párovanie zamestnancov: "táto
-- osoba pracuje preferovane s tamtou". Nezávislé od pozície aj prevádzky —
-- žiadny workplace_id/position_id. Vzťah je obojsmerný, ale ukladá sa ako
-- JEDEN riadok (employee_a_id < employee_b_id, appka vždy zoradí dvojicu
-- pred insertom) — nie dva samostatné smery, ktoré by sa mohli rozísť.
-- ============================================================================

CREATE TABLE "employee_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_a_id" uuid NOT NULL,
	"employee_b_id" uuid NOT NULL,
	"is_hard" boolean DEFAULT false NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "employee_pairings_order_check" CHECK ("employee_pairings"."employee_a_id" < "employee_pairings"."employee_b_id"),
	CONSTRAINT "employee_pairings_employee_a_id_employee_b_id_unique" UNIQUE("employee_a_id","employee_b_id")
);
--> statement-breakpoint
ALTER TABLE "employee_pairings" ADD CONSTRAINT "employee_pairings_employee_a_id_employees_id_fk" FOREIGN KEY ("employee_a_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pairings" ADD CONSTRAINT "employee_pairings_employee_b_id_employees_id_fk" FOREIGN KEY ("employee_b_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_pairings" ADD CONSTRAINT "employee_pairings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_pairings_employee_a_id_is_active_index" ON "employee_pairings" USING btree ("employee_a_id","is_active");--> statement-breakpoint
CREATE INDEX "employee_pairings_employee_b_id_is_active_index" ON "employee_pairings" USING btree ("employee_b_id","is_active");

-- ----------------------------------------------------------------------------
-- RLS — rovnaký vzor ako employee_availability_rules (migrácia 0001): owner
-- vidí/píše všetko, manažér len keď má prístup na workplace zamestnanca —
-- tu OBOCH zamestnancov páru naraz (write), respektíve ASPOŇ JEDNÉHO (select,
-- rovnaká logika ako emp_select — nech manažér vidí párovanie svojho člena
-- tímu, aj keď druhá strana páru je z inej prevádzky, ktorú nespravuje).
-- Zamestnanec vidí VLASTNÉ páry (`current_employee_id()`) — rovnaký princíp
-- ako `employee_id = current_employee_id()` v rules_select.
-- ----------------------------------------------------------------------------
ALTER TABLE employee_pairings ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_pairings_select ON employee_pairings FOR SELECT USING (
  is_owner()
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_pairings.employee_a_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
     )
  OR EXISTS (
      SELECT 1 FROM employee_workplaces ew
      WHERE ew.employee_id = employee_pairings.employee_b_id
        AND ew.workplace_id IN (SELECT accessible_workplaces())
     )
  OR employee_a_id = current_employee_id()
  OR employee_b_id = current_employee_id()
);

CREATE POLICY employee_pairings_write ON employee_pairings FOR ALL USING (
  is_owner()
  OR (current_user_role() = 'manager'
      AND EXISTS (SELECT 1 FROM employee_workplaces ew WHERE ew.employee_id = employee_pairings.employee_a_id AND ew.workplace_id IN (SELECT accessible_workplaces()))
      AND EXISTS (SELECT 1 FROM employee_workplaces ew WHERE ew.employee_id = employee_pairings.employee_b_id AND ew.workplace_id IN (SELECT accessible_workplaces()))
     )
) WITH CHECK (
  is_owner()
  OR (current_user_role() = 'manager'
      AND EXISTS (SELECT 1 FROM employee_workplaces ew WHERE ew.employee_id = employee_pairings.employee_a_id AND ew.workplace_id IN (SELECT accessible_workplaces()))
      AND EXISTS (SELECT 1 FROM employee_workplaces ew WHERE ew.employee_id = employee_pairings.employee_b_id AND ew.workplace_id IN (SELECT accessible_workplaces()))
     )
);

-- Audit log — rovnaký vzor ako employee_availability_rules.
CREATE TRIGGER audit_employee_pairings AFTER INSERT OR UPDATE OR DELETE ON employee_pairings
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
