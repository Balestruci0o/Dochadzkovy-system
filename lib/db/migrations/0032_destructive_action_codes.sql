-- ============================================================================
-- Blok 14 — mazanie konfigurácie/zamestnancov potvrdené e-mailovým kódom.
-- Rovnaký vzor ako email_otp_codes/email_otp_attempts (0027, 2FA), ale
-- SAMOSTATNÉ tabuľky — zdieľaný rate limit s prihlasovacím 2FA by znamenal,
-- že séria neúspešných potvrdení mazania môže zamknúť majiteľa aj z
-- PRIHLÁSENIA. Rovnaké RLS rozhodnutie ako 0027: `destructive_action_codes`
-- REVOKE ALL (nikdy netreba čítať hash kódu cez bežnú RLS cestu),
-- `destructive_action_attempts` len SELECT pre ownera (audit/prehľad).
-- ============================================================================

CREATE TYPE "destructive_action_target" AS ENUM ('legal_rule', 'coverage_requirement', 'shift_template', 'position', 'workplace', 'employee');

CREATE TABLE "destructive_action_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "destructive_action_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destructive_action_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"success" boolean NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "destructive_action_codes" ADD CONSTRAINT "destructive_action_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destructive_action_attempts" ADD CONSTRAINT "destructive_action_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "destructive_action_codes_user_id_target_type_target_id_index" ON "destructive_action_codes" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "destructive_action_attempts_user_id_created_at_index" ON "destructive_action_attempts" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "destructive_action_attempts"."success" = false;--> statement-breakpoint
CREATE INDEX "destructive_action_attempts_ip_created_at_index" ON "destructive_action_attempts" USING btree ("ip","created_at" DESC NULLS LAST) WHERE "destructive_action_attempts"."success" = false;

ALTER TABLE destructive_action_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON destructive_action_codes FROM app_user;

ALTER TABLE destructive_action_attempts ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON destructive_action_attempts FROM app_user;
GRANT SELECT ON destructive_action_attempts TO app_user;
CREATE POLICY destructive_action_attempts_select_owner ON destructive_action_attempts FOR SELECT USING (
  is_owner() AND EXISTS (SELECT 1 FROM users u WHERE u.id = destructive_action_attempts.user_id AND u.org_id = current_user_org_id())
);
