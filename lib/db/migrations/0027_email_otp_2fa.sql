-- ============================================================================
-- 2FA zmena: TOTP autentifikátor -> jednorazový 6-miestny kód mailom, LEN pre
-- rolu owner. `email_otp_codes` nesie samotné kódy (hash, expirácia,
-- jednorazovosť), `email_otp_attempts` je log pokusov o overenie (rate
-- limiting rovnakým vzorom ako login_events, lib/auth/rate-limit.ts).
-- `users.totp_secret`/`totp_enabled` boli len pre TOTP — mŕtve stĺpce, TOTP
-- faktory samotné žili v Supabase auth.mfa_factors, nie tu.
--
-- RLS: nové tabuľky dostanú CRUD grant pre app_user automaticky (ALTER
-- DEFAULT PRIVILEGES, 0002_app_role_grants.sql) — RLS je primárna obrana,
-- nie kód, preto vyžaduje explicitné zapnutie + odobratie
-- práv HNEĎ v tejto migrácii, nie "kód aj tak pristupuje len cez adminDb".
-- `email_otp_codes`: REVOKE ALL (rovnaký vzor ako terminals/qr_tokens) — niet
-- legitímny dôvod čítať hash kódu cez bežnú (RLS) cestu vôbec.
-- `email_otp_attempts`: rovnaký vzor ako login_events — žiadny zápis pre
-- app_user (zapisuje len lib/auth/email-otp-rate-limit.ts cez adminDb), len
-- SELECT pre ownera nad vlastnou organizáciou (audit/prehľad pokusov).
-- ============================================================================

CREATE TABLE "email_otp_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"success" boolean NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_otp_attempts" ADD CONSTRAINT "email_otp_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_otp_codes" ADD CONSTRAINT "email_otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_otp_attempts_user_id_created_at_index" ON "email_otp_attempts" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "email_otp_attempts"."success" = false;--> statement-breakpoint
CREATE INDEX "email_otp_codes_user_id_session_id_index" ON "email_otp_codes" USING btree ("user_id","session_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_secret";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "totp_enabled";--> statement-breakpoint

ALTER TABLE email_otp_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_otp_codes FROM app_user;

ALTER TABLE email_otp_attempts ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON email_otp_attempts FROM app_user;
GRANT SELECT ON email_otp_attempts TO app_user;
CREATE POLICY email_otp_attempts_select_owner ON email_otp_attempts FOR SELECT USING (
  is_owner() AND EXISTS (SELECT 1 FROM users u WHERE u.id = email_otp_attempts.user_id AND u.org_id = current_user_org_id())
);
