CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE TYPE "public"."absence_kind" AS ENUM('dovolenka', 'pn', 'ocr', 'paragraf', 'neplatene', 'nahradne_volno');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('planned', 'working', 'done', 'absent', 'missing', 'auto_closed');--> statement-breakpoint
CREATE TYPE "public"."availability_rule_type" AS ENUM('allowed_weekdays', 'blocked_weekdays', 'block_length', 'max_consecutive_days', 'min_rest_days', 'week_parity', 'date_range_available', 'date_range_blocked', 'max_hours_per_week', 'max_hours_per_month', 'min_hours_per_month', 'preferred_shift');--> statement-breakpoint
CREATE TYPE "public"."punch_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."punch_method" AS ENUM('qr_terminal', 'web', 'manual', 'auto_close');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."shift_source" AS ENUM('generated', 'manual', 'regenerated');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'employee', 'accountant');--> statement-breakpoint
CREATE TYPE "public"."violation_severity" AS ENUM('gap', 'hard_violation', 'soft_violation');--> statement-breakpoint
CREATE TABLE "absence_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "absence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"kind" "absence_kind" NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"is_partial_day" boolean DEFAULT false NOT NULL,
	"hours" numeric(5, 2),
	"reason" text,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "absence_requests_date_check" CHECK ("absence_requests"."date_to" >= "absence_requests"."date_from"),
	CONSTRAINT "absence_requests_rejection_note_check" CHECK ("absence_requests"."status" <> 'rejected' OR "absence_requests"."decision_note" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"request_id" uuid,
	"date" date NOT NULL,
	"kind" "absence_kind" NOT NULL,
	"hours" numeric(5, 2),
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_employee_id_date_unique" UNIQUE("employee_id","date")
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"date" date NOT NULL,
	"scheduled_shift_id" uuid,
	"planned_start" time,
	"planned_end" time,
	"actual_start" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"worked_hours" numeric(6, 3) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(6, 3) DEFAULT '0' NOT NULL,
	"weekend_hours" numeric(6, 3) DEFAULT '0' NOT NULL,
	"holiday_hours" numeric(6, 3) DEFAULT '0' NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"status" "attendance_status" DEFAULT 'planned' NOT NULL,
	"is_corrected" boolean DEFAULT false NOT NULL,
	"corrected_by" uuid,
	"corrected_at" timestamp with time zone,
	"correction_note" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_days_employee_id_date_unique" UNIQUE("employee_id","date")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"action" text NOT NULL,
	"old_data" jsonb,
	"new_data" jsonb,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "coverage_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workplace_id" uuid NOT NULL,
	"position_id" uuid,
	"min_people" integer DEFAULT 1 NOT NULL,
	"max_people" integer,
	"weekdays" smallint[] DEFAULT '{1,2,3,4,5,6,7}',
	"applies_holidays" boolean DEFAULT true NOT NULL,
	"is_hard" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid,
	"rule_type" "availability_rule_type" NOT NULL,
	"params" jsonb NOT NULL,
	"is_hard" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"note" text,
	"valid_from" date,
	"valid_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "employee_position_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "employee_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid,
	"hourly_rate" numeric(8, 4) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "employee_shift_templates" (
	"employee_id" uuid NOT NULL,
	"shift_template_id" uuid NOT NULL,
	"override_start_time" time,
	"override_end_time" time,
	"override_break_min" integer,
	"is_preferred" boolean DEFAULT false NOT NULL,
	CONSTRAINT "employee_shift_templates_employee_id_shift_template_id_pk" PRIMARY KEY("employee_id","shift_template_id")
);
--> statement-breakpoint
CREATE TABLE "employee_workplaces" (
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	CONSTRAINT "employee_workplaces_employee_id_workplace_id_pk" PRIMARY KEY("employee_id","workplace_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"personal_number" text,
	"phone" text,
	"email" "citext",
	"hired_on" date NOT NULL,
	"terminated_on" date,
	"contract_hours_per_week" numeric(5, 2),
	"contract_type" text,
	"vacation_days_per_year" numeric(5, 2) DEFAULT '20',
	"vacation_carried_over" numeric(5, 2) DEFAULT '0',
	"avatar_color" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "employees_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workplace_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"triggered_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"shifts_created" integer DEFAULT 0,
	"status" text,
	"input_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'SK' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"params" jsonb NOT NULL,
	"is_hard" boolean DEFAULT true NOT NULL,
	"law_reference" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "legal_rules_org_id_code_unique" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email_tried" "citext",
	"success" boolean NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_workplaces" (
	"user_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	CONSTRAINT "manager_workplaces_user_id_workplace_id_pk" PRIMARY KEY("user_id","workplace_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ico" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workplace_id" uuid,
	"name" text NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_day_id" uuid NOT NULL,
	"requested_start" timestamp with time zone,
	"requested_end" timestamp with time zone,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"workplace_id" uuid NOT NULL,
	"direction" "punch_direction" NOT NULL,
	"method" "punch_method" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_offline_sync" boolean DEFAULT false NOT NULL,
	"terminal_id" uuid,
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"gps_accuracy_m" numeric(8, 2),
	"gps_distance_m" numeric(10, 2),
	"gps_suspicious" boolean DEFAULT false NOT NULL,
	"qr_token_jti" text,
	"ip" "inet",
	"user_agent" text,
	"corrects_event_id" bigint,
	"correction_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "punch_events_qr_token_jti_unique" UNIQUE("qr_token_jti")
);
--> statement-breakpoint
CREATE TABLE "qr_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_terminal" uuid
);
--> statement-breakpoint
CREATE TABLE "schedule_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"generation_run_id" uuid,
	"date" date NOT NULL,
	"employee_id" uuid,
	"position_id" uuid,
	"severity" "violation_severity" NOT NULL,
	"rule_code" text NOT NULL,
	"rule_source" text,
	"message" text NOT NULL,
	"details" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_shifts" (
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
	"source" "shift_source" DEFAULT 'generated' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "scheduled_shifts_employee_id_workplace_id_date_unique" UNIQUE("employee_id","workplace_id","date")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workplace_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "schedule_status" DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp with time zone,
	"generated_by" uuid,
	"generation_run_id" uuid,
	CONSTRAINT "schedules_workplace_id_year_month_unique" UNIQUE("workplace_id","year","month"),
	CONSTRAINT "schedules_month_check" CHECK ("schedules"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workplace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"break_minutes" integer DEFAULT 30 NOT NULL,
	"color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "shift_templates_workplace_id_code_unique" UNIQUE("workplace_id","code")
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workplace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"device_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"last_seen_at" timestamp with time zone,
	"firmware_version" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminals_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"email" "citext" NOT NULL,
	"role" "user_role" NOT NULL,
	"full_name" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"invited_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "users_org_id_email_unique" UNIQUE("org_id","email")
);
--> statement-breakpoint
CREATE TABLE "vacation_balances" (
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"entitled_days" numeric(5, 2) NOT NULL,
	"carried_over_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"taken_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "vacation_balances_employee_id_year_pk" PRIMARY KEY("employee_id","year")
);
--> statement-breakpoint
CREATE TABLE "workplace_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workplace_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workplace_closures_workplace_id_date_unique" UNIQUE("workplace_id","date")
);
--> statement-breakpoint
CREATE TABLE "workplaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Bratislava' NOT NULL,
	"operating_days" smallint[] DEFAULT '{1,2,3,4,5,6,7}' NOT NULL,
	"operates_holidays" boolean DEFAULT true NOT NULL,
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"gps_radius_m" integer DEFAULT 150,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workplaces_org_id_code_unique" UNIQUE("org_id","code")
);
--> statement-breakpoint
ALTER TABLE "absence_attachments" ADD CONSTRAINT "absence_attachments_request_id_absence_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."absence_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_attachments" ADD CONSTRAINT "absence_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_requests" ADD CONSTRAINT "absence_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_request_id_absence_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."absence_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_scheduled_shift_id_scheduled_shifts_id_fk" FOREIGN KEY ("scheduled_shift_id") REFERENCES "public"."scheduled_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requirements" ADD CONSTRAINT "coverage_requirements_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_requirements" ADD CONSTRAINT "coverage_requirements_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability_rules" ADD CONSTRAINT "employee_availability_rules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability_rules" ADD CONSTRAINT "employee_availability_rules_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability_rules" ADD CONSTRAINT "employee_availability_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_position_history" ADD CONSTRAINT "employee_position_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_position_history" ADD CONSTRAINT "employee_position_history_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_position_history" ADD CONSTRAINT "employee_position_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rate_history" ADD CONSTRAINT "employee_rate_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shift_templates" ADD CONSTRAINT "employee_shift_templates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shift_templates" ADD CONSTRAINT "employee_shift_templates_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_workplaces" ADD CONSTRAINT "employee_workplaces_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_workplaces" ADD CONSTRAINT "employee_workplaces_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_rules" ADD CONSTRAINT "legal_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_workplaces" ADD CONSTRAINT "manager_workplaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_workplaces" ADD CONSTRAINT "manager_workplaces_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_correction_requests" ADD CONSTRAINT "punch_correction_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_correction_requests" ADD CONSTRAINT "punch_correction_requests_attendance_day_id_attendance_days_id_fk" FOREIGN KEY ("attendance_day_id") REFERENCES "public"."attendance_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_correction_requests" ADD CONSTRAINT "punch_correction_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_corrects_event_id_punch_events_id_fk" FOREIGN KEY ("corrects_event_id") REFERENCES "public"."punch_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_used_by_terminal_terminals_id_fk" FOREIGN KEY ("used_by_terminal") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_violations" ADD CONSTRAINT "schedule_violations_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_violations" ADD CONSTRAINT "schedule_violations_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_violations" ADD CONSTRAINT "schedule_violations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_violations" ADD CONSTRAINT "schedule_violations_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_shift_template_id_shift_templates_id_fk" FOREIGN KEY ("shift_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_balances" ADD CONSTRAINT "vacation_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workplace_closures" ADD CONSTRAINT "workplace_closures_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workplaces" ADD CONSTRAINT "workplaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_requests_workplace_id_status_date_from_index" ON "absence_requests" USING btree ("workplace_id","status","date_from");--> statement-breakpoint
CREATE INDEX "absence_requests_employee_id_date_from_index" ON "absence_requests" USING btree ("employee_id","date_from");--> statement-breakpoint
CREATE INDEX "absences_workplace_id_date_index" ON "absences" USING btree ("workplace_id","date");--> statement-breakpoint
CREATE INDEX "attendance_days_workplace_id_date_index" ON "attendance_days" USING btree ("workplace_id","date");--> statement-breakpoint
CREATE INDEX "attendance_days_employee_id_date_index" ON "attendance_days" USING btree ("employee_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_table_name_record_id_changed_at_index" ON "audit_log" USING btree ("table_name","record_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_changed_by_changed_at_index" ON "audit_log" USING btree ("changed_by","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "employee_availability_rules_employee_id_is_active_index" ON "employee_availability_rules" USING btree ("employee_id","is_active");--> statement-breakpoint
CREATE INDEX "employees_org_id_is_active_index" ON "employees" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE INDEX "login_events_user_id_created_at_index" ON "login_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_created_at_index" ON "notifications" USING btree ("user_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "punch_events_employee_id_occurred_at_index" ON "punch_events" USING btree ("employee_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "punch_events_workplace_id_occurred_at_index" ON "punch_events" USING btree ("workplace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "qr_tokens_expires_at_index" ON "qr_tokens" USING btree ("expires_at") WHERE "qr_tokens"."used_at" IS NULL;--> statement-breakpoint
CREATE INDEX "schedule_violations_schedule_id_resolved_date_index" ON "schedule_violations" USING btree ("schedule_id","resolved","date");--> statement-breakpoint
CREATE INDEX "scheduled_shifts_workplace_id_date_index" ON "scheduled_shifts" USING btree ("workplace_id","date");--> statement-breakpoint
CREATE INDEX "scheduled_shifts_employee_id_date_index" ON "scheduled_shifts" USING btree ("employee_id","date");