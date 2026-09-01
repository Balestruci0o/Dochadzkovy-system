-- ============================================================================
-- DOCHÁDZKOVÝ SYSTÉM
-- PostgreSQL schéma (Supabase / Postgres 17, lokálny vývojový stack)
--
-- GENEROVANÝ SÚBOR — needituje sa ručne. Vygenerovaný z čistej databázy PO
-- aplikovaní všetkých migrácií (Fáza L, balík L5, 2026-08-25):
--
--   npm run dev:bootstrap -- --reset      # čistá lokálna DB, migrácie aplikované
--   docker exec supabase_db_doch_dzka \
--     pg_dump -U postgres -d postgres --schema-only --schema=public \
--     --no-owner --no-privileges > schema.sql
--
-- (Vedome `pg_dump` v kontajneri, nie `supabase db dump` — ten by pridal
-- Supabase-špecifické objekty, ktoré do tejto schémy nepatria.)
--
-- Záväzný zdroj pravdy sú aj napriek tomu VÝHRADNE migrácie v
-- lib/db/migrations/ (spúšťané cez `npm run db:migrate`) — tento súbor je
-- len čitateľný, pravidelne regenerovaný odraz ich výsledku, pri
-- akomkoľvek rozpore rozhodujú vždy ony. Viď docs/ARCHITECTURE.md, sekcia 1.
--
-- Keď pribudne nová migrácia, tento súbor treba znova vygenerovať presne
-- príkazom vyššie — inak sa opäť rozíde od skutočnej schémy (presne to sa
-- stalo predchádzajúcej ručne udržiavanej verzii, viď NALEZY.md, "L5").
--
-- Princípy (nemenia sa regeneráciou, patria sem ako trvalý kontext):
--   1. MULTI-TENANT po prevádzkach — izolácia cez RLS, nie cez aplikačnú logiku
--   2. ZAMESTNANEC = konfigurovateľná entita — žiadne fixné číselníky zmien
--   3. PRAVIDLÁ = dáta, nie kód — každé s hard/soft flagom
--   4. HISTÓRIA — pozície a sadzby sa menia v čase, staré výkazy musia sedieť
--   5. AUDIT — každá zmena dochádzky/mzdy je dohľadateľná
--   6. IMMUTABLE RAZÍTKA — punch sa nikdy needituje, len pridáva oprava
-- ============================================================================

--
-- PostgreSQL database dump
--

\restrict 1fhi2km0KCoEPVRJNdw5jtr8z3fo9RBc6iJpFILicCZZhbO4eA789EpYs8pxiNi

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: absence_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.absence_kind AS ENUM (
    'dovolenka',
    'pn',
    'ocr',
    'paragraf',
    'neplatene',
    'nahradne_volno'
);


--
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_status AS ENUM (
    'planned',
    'working',
    'done',
    'absent',
    'missing',
    'auto_closed'
);


--
-- Name: availability_rule_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.availability_rule_type AS ENUM (
    'allowed_weekdays',
    'blocked_weekdays',
    'block_length',
    'max_consecutive_days',
    'min_rest_days',
    'week_parity',
    'date_range_available',
    'date_range_blocked',
    'max_hours_per_week',
    'max_hours_per_month',
    'min_hours_per_month',
    'preferred_shift'
);


--
-- Name: break_config_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.break_config_mode AS ENUM (
    'minuty',
    'presny_cas'
);


--
-- Name: break_tracking_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.break_tracking_mode AS ENUM (
    'automaticky',
    'pipa'
);


--
-- Name: destructive_action_target; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.destructive_action_target AS ENUM (
    'legal_rule',
    'coverage_requirement',
    'shift_template',
    'position',
    'workplace',
    'employee',
    'user_account'
);


--
-- Name: pay_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pay_mode AS ENUM (
    'hodinovy',
    'fixny'
);


--
-- Name: punch_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.punch_direction AS ENUM (
    'in',
    'out'
);


--
-- Name: punch_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.punch_kind AS ENUM (
    'zmena',
    'prestavka'
);


--
-- Name: punch_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.punch_method AS ENUM (
    'qr_terminal',
    'web',
    'manual',
    'auto_close'
);


--
-- Name: request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.request_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);


--
-- Name: schedule_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.schedule_status AS ENUM (
    'draft',
    'published'
);


--
-- Name: shift_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shift_source AS ENUM (
    'generated',
    'manual',
    'regenerated'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'owner',
    'manager',
    'employee',
    'accountant'
);


--
-- Name: violation_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.violation_severity AS ENUM (
    'gap',
    'hard_violation',
    'soft_violation'
);


--
-- Name: work_time_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_time_mode AS ENUM (
    'rovnomerny',
    'nerovnomerny_turnus'
);


--
-- Name: accessible_workplaces(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accessible_workplaces() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT w.id FROM workplaces w
  JOIN users u ON u.id = current_user_id()
  WHERE u.role IN ('owner','accountant') AND w.org_id = u.org_id
  UNION
  SELECT mw.workplace_id FROM manager_workplaces mw
  WHERE mw.user_id = current_user_id()
  UNION
  SELECT ew.workplace_id FROM employee_workplaces ew
  JOIN employees e ON e.id = ew.employee_id
  WHERE e.user_id = current_user_id();
$$;


--
-- Name: audit_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  actor uuid;
  row_data jsonb;
  resolved_org_id uuid;
BEGIN
  -- ID používateľa nastaví aplikácia cez SET LOCAL app.user_id
  BEGIN
    actor := current_setting('app.user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    actor := NULL;
  END;

  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  resolved_org_id := NULLIF(row_data->>'org_id', '')::uuid;

  IF resolved_org_id IS NULL AND row_data ? 'employee_id' THEN
    SELECT org_id INTO resolved_org_id FROM employees WHERE id = NULLIF(row_data->>'employee_id', '')::uuid;
  END IF;

  IF resolved_org_id IS NULL AND row_data ? 'employee_a_id' THEN
    SELECT org_id INTO resolved_org_id FROM employees WHERE id = NULLIF(row_data->>'employee_a_id', '')::uuid;
  END IF;

  IF resolved_org_id IS NULL AND row_data ? 'workplace_id' THEN
    SELECT org_id INTO resolved_org_id FROM workplaces WHERE id = NULLIF(row_data->>'workplace_id', '')::uuid;
  END IF;

  INSERT INTO audit_log (org_id, table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    resolved_org_id,
    TG_TABLE_NAME,
    COALESCE(NEW.id::text, OLD.id::text),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
    actor
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: create_notification(uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_notification(p_user_id uuid, p_kind text, p_title text, p_body text DEFAULT NULL::text, p_link text DEFAULT NULL::text, p_payload jsonb DEFAULT NULL::jsonb) RETURNS TABLE(notification_id uuid, recipient_email text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  WITH inserted AS (
    INSERT INTO notifications (user_id, kind, title, body, link, payload)
    VALUES (p_user_id, p_kind, p_title, p_body, p_link, p_payload)
    RETURNING id
  )
  SELECT inserted.id, u.email FROM inserted JOIN users u ON u.id = p_user_id;
$$;


--
-- Name: current_employee_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_employee_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT id FROM employees WHERE user_id = current_user_id();
$$;


--
-- Name: current_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;


--
-- Name: current_user_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT org_id FROM users WHERE id = current_user_id();
$$;


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS public.user_role
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT role FROM users WHERE id = current_user_id();
$$;


--
-- Name: has_manager_permission(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_manager_permission(perm text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT
    is_owner()
    OR (
      current_user_role() = 'manager'
      AND COALESCE(
        (SELECT CASE perm
          WHEN 'manage_positions_shifts' THEN mp.manage_positions_shifts
          WHEN 'manage_rules'            THEN mp.manage_rules
          WHEN 'manage_accounts'         THEN mp.manage_accounts
          WHEN 'view_wages'              THEN mp.view_wages
          WHEN 'edit_wages'              THEN mp.edit_wages
          WHEN 'manage_terminals'        THEN mp.manage_terminals
          ELSE false
        END
        FROM manager_permissions mp WHERE mp.user_id = current_user_id()),
        -- Žiadny riadok → hardcoded default. MUSÍ sedieť so stĺpcovými
        -- defaultmi vyššie (jediný balíček default-true je view_wages).
        perm = 'view_wages'
      )
    );
$$;


--
-- Name: is_channel_enabled(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_channel_enabled(p_user_id uuid, p_kind text, p_channel text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(
    (SELECT enabled FROM notification_preferences WHERE user_id = p_user_id AND kind = p_kind AND channel = p_channel),
    true
  );
$$;


--
-- Name: is_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT current_user_role() = 'owner';
$$;


--
-- Name: mark_notification_email_sent(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_notification_email_sent(p_notification_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    AS $$
  UPDATE notifications SET email_sent_at = now() WHERE id = p_notification_id;
$$;


--
-- Name: materialize_absence_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.materialize_absence_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  d DATE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('rejected', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM absences WHERE request_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('pending', 'approved') THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM absences WHERE request_id = NEW.id;
    END IF;

    d := NEW.date_from;
    WHILE d <= NEW.date_to LOOP
      INSERT INTO absences (employee_id, workplace_id, request_id, date, kind, hours, is_confirmed)
      VALUES (NEW.employee_id, NEW.workplace_id, NEW.id, d, NEW.kind, NEW.hours, NEW.status = 'approved')
      ON CONFLICT (employee_id, date) DO NOTHING;
      d := d + 1;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: punch_events_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.punch_events_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  confirmed_employee_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    BEGIN
      confirmed_employee_id := NULLIF(current_setting('app.confirmed_employee_delete_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      confirmed_employee_id := NULL;
    END;
    IF confirmed_employee_id IS NOT NULL AND confirmed_employee_id = OLD.employee_id THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'punch_events je append-only: UPDATE/DELETE nie je povolené. Použi opravnú udalosť (corrects_event_id).';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    auth_user_id uuid,
    email public.citext,
    role public.user_role NOT NULL,
    full_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    invited_at timestamp with time zone,
    activated_at timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    phone text,
    deleted_at timestamp with time zone
);


--
-- Name: stored_user_row(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stored_user_row(target_id uuid) RETURNS public.users
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT * FROM users WHERE id = target_id;
$$;


--
-- Name: workplace_managers_and_owner(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workplace_managers_and_owner(p_workplace_id uuid, p_org_id uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT mw.user_id FROM manager_workplaces mw WHERE mw.workplace_id = p_workplace_id
  UNION
  SELECT u.id FROM users u WHERE u.org_id = p_org_id AND u.role = 'owner' AND u.is_active = true;
$$;


--
-- Name: absence_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.absence_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    file_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: absence_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.absence_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    kind public.absence_kind NOT NULL,
    date_from date NOT NULL,
    date_to date NOT NULL,
    is_partial_day boolean DEFAULT false NOT NULL,
    hours numeric(5,2),
    reason text,
    status public.request_status DEFAULT 'pending'::public.request_status NOT NULL,
    requested_by uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    CONSTRAINT absence_requests_date_check CHECK ((date_to >= date_from)),
    CONSTRAINT absence_requests_rejection_note_check CHECK (((status <> 'rejected'::public.request_status) OR (decision_note IS NOT NULL)))
);


--
-- Name: absences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.absences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    request_id uuid,
    date date NOT NULL,
    kind public.absence_kind NOT NULL,
    hours numeric(5,2),
    is_confirmed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_days (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    date date NOT NULL,
    scheduled_shift_id uuid,
    planned_start time without time zone,
    planned_end time without time zone,
    actual_start timestamp with time zone,
    actual_end timestamp with time zone,
    break_minutes integer DEFAULT 0 NOT NULL,
    worked_hours numeric(6,3) DEFAULT '0'::numeric NOT NULL,
    overtime_hours numeric(6,3) DEFAULT '0'::numeric NOT NULL,
    weekend_hours numeric(6,3) DEFAULT '0'::numeric NOT NULL,
    holiday_hours numeric(6,3) DEFAULT '0'::numeric NOT NULL,
    is_late boolean DEFAULT false NOT NULL,
    late_minutes integer DEFAULT 0 NOT NULL,
    status public.attendance_status DEFAULT 'planned'::public.attendance_status NOT NULL,
    is_corrected boolean DEFAULT false NOT NULL,
    corrected_by uuid,
    corrected_at timestamp with time zone,
    correction_note text,
    is_locked boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    night_hours numeric(6,3) DEFAULT 0 NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    org_id uuid,
    table_name text NOT NULL,
    record_id text NOT NULL,
    action text NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    ip inet
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: coverage_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workplace_id uuid NOT NULL,
    position_id uuid,
    min_people integer DEFAULT 1 NOT NULL,
    max_people integer,
    weekdays smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[],
    applies_holidays boolean DEFAULT true NOT NULL,
    is_hard boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    shift_template_id uuid
);


--
-- Name: destructive_action_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.destructive_action_attempts (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    success boolean NOT NULL,
    ip inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: destructive_action_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.destructive_action_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: destructive_action_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.destructive_action_attempts_id_seq OWNED BY public.destructive_action_attempts.id;


--
-- Name: destructive_action_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.destructive_action_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    target_type public.destructive_action_target NOT NULL,
    target_id uuid NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_otp_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_otp_attempts (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    success boolean NOT NULL,
    ip inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_otp_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_otp_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_otp_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_otp_attempts_id_seq OWNED BY public.email_otp_attempts.id;


--
-- Name: email_otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_availability_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_availability_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid,
    rule_type public.availability_rule_type NOT NULL,
    params jsonb NOT NULL,
    is_hard boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    note text,
    valid_from date,
    valid_to date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: employee_pairings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_pairings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_a_id uuid NOT NULL,
    employee_b_id uuid NOT NULL,
    is_hard boolean DEFAULT false NOT NULL,
    note text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT employee_pairings_order_check CHECK ((employee_a_id < employee_b_id))
);


--
-- Name: employee_position_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_position_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    position_id uuid NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: employee_rate_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_rate_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid,
    hourly_rate numeric(8,4) NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: employee_salary_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_salary_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    fix_amount numeric(10,2) NOT NULL,
    variable_amount numeric(10,2) DEFAULT 0 NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: employee_shift_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_shift_templates (
    employee_id uuid NOT NULL,
    shift_template_id uuid NOT NULL,
    override_start_time time without time zone,
    override_end_time time without time zone,
    override_break_min integer,
    is_preferred boolean DEFAULT false NOT NULL
);


--
-- Name: employee_workplaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_workplaces (
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    is_primary boolean DEFAULT true NOT NULL
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    first_name text NOT NULL,
    last_name text NOT NULL,
    personal_number text,
    phone text,
    email public.citext,
    hired_on date NOT NULL,
    terminated_on date,
    contract_hours_per_month numeric(5,2),
    contract_type text,
    vacation_days_per_year numeric(5,2) DEFAULT '20'::numeric,
    vacation_carried_over numeric(5,2) DEFAULT '0'::numeric,
    avatar_color text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    work_time_mode public.work_time_mode DEFAULT 'rovnomerny'::public.work_time_mode NOT NULL,
    balancing_period_months integer DEFAULT 4 NOT NULL,
    override_break_tracking_mode public.break_tracking_mode,
    can_punch_web boolean DEFAULT false NOT NULL,
    can_be_shift_leader boolean DEFAULT false NOT NULL,
    override_pay_mode public.pay_mode
);


--
-- Name: generation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workplace_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    triggered_by uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    shifts_created integer DEFAULT 0,
    status text,
    input_snapshot jsonb
);


--
-- Name: holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holidays (
    date date NOT NULL,
    name text NOT NULL,
    country text DEFAULT 'SK'::text NOT NULL
);


--
-- Name: legal_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    params jsonb NOT NULL,
    is_hard boolean DEFAULT true NOT NULL,
    law_reference text,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: login_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_events (
    id bigint NOT NULL,
    user_id uuid,
    email_tried public.citext,
    success boolean NOT NULL,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: login_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_events_id_seq OWNED BY public.login_events.id;


--
-- Name: manager_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    manage_positions_shifts boolean DEFAULT false NOT NULL,
    manage_rules boolean DEFAULT false NOT NULL,
    manage_accounts boolean DEFAULT false NOT NULL,
    view_wages boolean DEFAULT true NOT NULL,
    edit_wages boolean DEFAULT false NOT NULL,
    manage_terminals boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: manager_workplaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_workplaces (
    user_id uuid NOT NULL,
    workplace_id uuid NOT NULL
);


--
-- Name: missing_punch_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.missing_punch_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    date date NOT NULL,
    direction public.punch_direction NOT NULL,
    kind public.punch_kind DEFAULT 'zmena'::public.punch_kind NOT NULL,
    requested_time timestamp with time zone NOT NULL,
    reason text NOT NULL,
    status public.request_status DEFAULT 'pending'::public.request_status NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    kind text NOT NULL,
    channel text NOT NULL,
    enabled boolean DEFAULT true NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    payload jsonb,
    read_at timestamp with time zone,
    email_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    ico text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    support_name text,
    support_email text,
    support_phone text
);


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    workplace_id uuid,
    name text NOT NULL,
    color text,
    is_active boolean DEFAULT true NOT NULL,
    break_tracking_mode public.break_tracking_mode DEFAULT 'automaticky'::public.break_tracking_mode NOT NULL,
    requires_shift_leader boolean DEFAULT false NOT NULL,
    pay_mode public.pay_mode DEFAULT 'hodinovy'::public.pay_mode NOT NULL
);


--
-- Name: published_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.published_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    date date NOT NULL,
    shift_template_id uuid,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    break_minutes integer DEFAULT 0 NOT NULL,
    crosses_midnight boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    published_by uuid
);


--
-- Name: punch_correction_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.punch_correction_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    attendance_day_id uuid NOT NULL,
    requested_start timestamp with time zone,
    requested_end timestamp with time zone,
    reason text NOT NULL,
    status public.request_status DEFAULT 'pending'::public.request_status NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: punch_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.punch_events (
    id bigint NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    direction public.punch_direction NOT NULL,
    method public.punch_method NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    is_offline_sync boolean DEFAULT false NOT NULL,
    terminal_id uuid,
    gps_lat numeric(10,7),
    gps_lng numeric(10,7),
    gps_accuracy_m numeric(8,2),
    gps_distance_m numeric(10,2),
    gps_suspicious boolean DEFAULT false NOT NULL,
    qr_token_jti text,
    ip inet,
    user_agent text,
    corrects_event_id bigint,
    correction_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind public.punch_kind DEFAULT 'zmena'::public.punch_kind NOT NULL,
    is_void boolean DEFAULT false NOT NULL
);


--
-- Name: punch_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.punch_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: punch_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.punch_events_id_seq OWNED BY public.punch_events.id;


--
-- Name: qr_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_tokens (
    jti text NOT NULL,
    employee_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by_terminal uuid
);


--
-- Name: schedule_violations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_violations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    generation_run_id uuid,
    date date NOT NULL,
    employee_id uuid,
    position_id uuid,
    severity public.violation_severity NOT NULL,
    rule_code text NOT NULL,
    rule_source text,
    message text NOT NULL,
    details jsonb,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scheduled_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    date date NOT NULL,
    shift_template_id uuid,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    break_minutes integer DEFAULT 0 NOT NULL,
    crosses_midnight boolean DEFAULT false NOT NULL,
    source public.shift_source DEFAULT 'generated'::public.shift_source NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workplace_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    status public.schedule_status DEFAULT 'draft'::public.schedule_status NOT NULL,
    generated_at timestamp with time zone,
    generated_by uuid,
    generation_run_id uuid,
    CONSTRAINT schedules_month_check CHECK (((month >= 1) AND (month <= 12)))
);


--
-- Name: shift_leader_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_leader_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    workplace_id uuid NOT NULL,
    position_id uuid NOT NULL,
    date date NOT NULL,
    employee_id uuid,
    source public.shift_source NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shift_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workplace_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    crosses_midnight boolean DEFAULT false NOT NULL,
    break_minutes integer DEFAULT 30 NOT NULL,
    color text,
    is_active boolean DEFAULT true NOT NULL,
    break_mode public.break_config_mode DEFAULT 'minuty'::public.break_config_mode NOT NULL,
    break_start_time time without time zone,
    break_end_time time without time zone
);


--
-- Name: terminals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workplace_id uuid NOT NULL,
    name text NOT NULL,
    device_id text NOT NULL,
    secret_hash text NOT NULL,
    gps_lat numeric(10,7),
    gps_lng numeric(10,7),
    last_seen_at timestamp with time zone,
    firmware_version text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vacation_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacation_balances (
    employee_id uuid NOT NULL,
    year integer NOT NULL,
    entitled_days numeric(5,2) NOT NULL,
    carried_over_days numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    taken_days numeric(5,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: workplace_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workplace_closures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workplace_id uuid NOT NULL,
    date date NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workplaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workplaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    timezone text DEFAULT 'Europe/Bratislava'::text NOT NULL,
    operating_days smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
    operates_holidays boolean DEFAULT true NOT NULL,
    gps_lat numeric(10,7),
    gps_lng numeric(10,7),
    gps_radius_m integer DEFAULT 150,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: destructive_action_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destructive_action_attempts ALTER COLUMN id SET DEFAULT nextval('public.destructive_action_attempts_id_seq'::regclass);


--
-- Name: email_otp_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_otp_attempts ALTER COLUMN id SET DEFAULT nextval('public.email_otp_attempts_id_seq'::regclass);


--
-- Name: login_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_events ALTER COLUMN id SET DEFAULT nextval('public.login_events_id_seq'::regclass);


--
-- Name: punch_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events ALTER COLUMN id SET DEFAULT nextval('public.punch_events_id_seq'::regclass);


--
-- Name: absence_attachments absence_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_attachments
    ADD CONSTRAINT absence_attachments_pkey PRIMARY KEY (id);


--
-- Name: absence_requests absence_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_pkey PRIMARY KEY (id);


--
-- Name: absences absences_employee_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_employee_id_date_unique UNIQUE (employee_id, date);


--
-- Name: absences absences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_pkey PRIMARY KEY (id);


--
-- Name: attendance_days attendance_days_employee_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_days
    ADD CONSTRAINT attendance_days_employee_id_date_unique UNIQUE (employee_id, date);


--
-- Name: attendance_days attendance_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_days
    ADD CONSTRAINT attendance_days_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: coverage_requirements coverage_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_requirements
    ADD CONSTRAINT coverage_requirements_pkey PRIMARY KEY (id);


--
-- Name: destructive_action_attempts destructive_action_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destructive_action_attempts
    ADD CONSTRAINT destructive_action_attempts_pkey PRIMARY KEY (id);


--
-- Name: destructive_action_codes destructive_action_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destructive_action_codes
    ADD CONSTRAINT destructive_action_codes_pkey PRIMARY KEY (id);


--
-- Name: email_otp_attempts email_otp_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_otp_attempts
    ADD CONSTRAINT email_otp_attempts_pkey PRIMARY KEY (id);


--
-- Name: email_otp_codes email_otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_otp_codes
    ADD CONSTRAINT email_otp_codes_pkey PRIMARY KEY (id);


--
-- Name: employee_availability_rules employee_availability_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_availability_rules
    ADD CONSTRAINT employee_availability_rules_pkey PRIMARY KEY (id);


--
-- Name: employee_pairings employee_pairings_employee_a_id_employee_b_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pairings
    ADD CONSTRAINT employee_pairings_employee_a_id_employee_b_id_unique UNIQUE (employee_a_id, employee_b_id);


--
-- Name: employee_pairings employee_pairings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pairings
    ADD CONSTRAINT employee_pairings_pkey PRIMARY KEY (id);


--
-- Name: employee_position_history employee_position_history_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_position_history
    ADD CONSTRAINT employee_position_history_no_overlap EXCLUDE USING gist (employee_id WITH =, daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)'::text) WITH &&);


--
-- Name: employee_position_history employee_position_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_position_history
    ADD CONSTRAINT employee_position_history_pkey PRIMARY KEY (id);


--
-- Name: employee_rate_history employee_rate_history_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rate_history
    ADD CONSTRAINT employee_rate_history_no_overlap EXCLUDE USING gist (employee_id WITH =, COALESCE(workplace_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =, daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)'::text) WITH &&);


--
-- Name: employee_rate_history employee_rate_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rate_history
    ADD CONSTRAINT employee_rate_history_pkey PRIMARY KEY (id);


--
-- Name: employee_salary_history employee_salary_history_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_salary_history
    ADD CONSTRAINT employee_salary_history_no_overlap EXCLUDE USING gist (employee_id WITH =, daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)'::text) WITH &&);


--
-- Name: employee_salary_history employee_salary_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_salary_history
    ADD CONSTRAINT employee_salary_history_pkey PRIMARY KEY (id);


--
-- Name: employee_shift_templates employee_shift_templates_employee_id_shift_template_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shift_templates
    ADD CONSTRAINT employee_shift_templates_employee_id_shift_template_id_pk PRIMARY KEY (employee_id, shift_template_id);


--
-- Name: employee_workplaces employee_workplaces_employee_id_workplace_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workplaces
    ADD CONSTRAINT employee_workplaces_employee_id_workplace_id_pk PRIMARY KEY (employee_id, workplace_id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: employees employees_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_unique UNIQUE (user_id);


--
-- Name: generation_runs generation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_runs
    ADD CONSTRAINT generation_runs_pkey PRIMARY KEY (id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (date);


--
-- Name: legal_rules legal_rules_org_id_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_rules
    ADD CONSTRAINT legal_rules_org_id_code_unique UNIQUE (org_id, code);


--
-- Name: legal_rules legal_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_rules
    ADD CONSTRAINT legal_rules_pkey PRIMARY KEY (id);


--
-- Name: login_events login_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_pkey PRIMARY KEY (id);


--
-- Name: manager_permissions manager_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_permissions
    ADD CONSTRAINT manager_permissions_pkey PRIMARY KEY (id);


--
-- Name: manager_permissions manager_permissions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_permissions
    ADD CONSTRAINT manager_permissions_user_id_key UNIQUE (user_id);


--
-- Name: manager_workplaces manager_workplaces_user_id_workplace_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_workplaces
    ADD CONSTRAINT manager_workplaces_user_id_workplace_id_pk PRIMARY KEY (user_id, workplace_id);


--
-- Name: missing_punch_requests missing_punch_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missing_punch_requests
    ADD CONSTRAINT missing_punch_requests_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, kind, channel);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: published_shifts published_shifts_employee_id_workplace_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_shifts
    ADD CONSTRAINT published_shifts_employee_id_workplace_id_date_unique UNIQUE (employee_id, workplace_id, date);


--
-- Name: published_shifts published_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_shifts
    ADD CONSTRAINT published_shifts_pkey PRIMARY KEY (id);


--
-- Name: punch_correction_requests punch_correction_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_correction_requests
    ADD CONSTRAINT punch_correction_requests_pkey PRIMARY KEY (id);


--
-- Name: punch_events punch_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events
    ADD CONSTRAINT punch_events_pkey PRIMARY KEY (id);


--
-- Name: punch_events punch_events_qr_token_jti_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events
    ADD CONSTRAINT punch_events_qr_token_jti_unique UNIQUE (qr_token_jti);


--
-- Name: qr_tokens qr_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_tokens
    ADD CONSTRAINT qr_tokens_pkey PRIMARY KEY (jti);


--
-- Name: schedule_violations schedule_violations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_violations
    ADD CONSTRAINT schedule_violations_pkey PRIMARY KEY (id);


--
-- Name: scheduled_shifts scheduled_shifts_employee_id_workplace_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_shifts
    ADD CONSTRAINT scheduled_shifts_employee_id_workplace_id_date_unique UNIQUE (employee_id, workplace_id, date);


--
-- Name: scheduled_shifts scheduled_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_shifts
    ADD CONSTRAINT scheduled_shifts_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_workplace_id_year_month_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_workplace_id_year_month_unique UNIQUE (workplace_id, year, month);


--
-- Name: shift_leader_assignments shift_leader_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_leader_assignments
    ADD CONSTRAINT shift_leader_assignments_pkey PRIMARY KEY (id);


--
-- Name: shift_leader_assignments shift_leader_assignments_workplace_id_position_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_leader_assignments
    ADD CONSTRAINT shift_leader_assignments_workplace_id_position_id_date_unique UNIQUE (workplace_id, position_id, date);


--
-- Name: shift_templates shift_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_templates
    ADD CONSTRAINT shift_templates_pkey PRIMARY KEY (id);


--
-- Name: shift_templates shift_templates_workplace_id_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_templates
    ADD CONSTRAINT shift_templates_workplace_id_code_unique UNIQUE (workplace_id, code);


--
-- Name: terminals terminals_device_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_device_id_unique UNIQUE (device_id);


--
-- Name: terminals terminals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_pkey PRIMARY KEY (id);


--
-- Name: users users_auth_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_user_id_unique UNIQUE (auth_user_id);


--
-- Name: users users_org_id_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_id_email_unique UNIQUE (org_id, email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vacation_balances vacation_balances_employee_id_year_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacation_balances
    ADD CONSTRAINT vacation_balances_employee_id_year_pk PRIMARY KEY (employee_id, year);


--
-- Name: workplace_closures workplace_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workplace_closures
    ADD CONSTRAINT workplace_closures_pkey PRIMARY KEY (id);


--
-- Name: workplace_closures workplace_closures_workplace_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workplace_closures
    ADD CONSTRAINT workplace_closures_workplace_id_date_unique UNIQUE (workplace_id, date);


--
-- Name: workplaces workplaces_org_id_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workplaces
    ADD CONSTRAINT workplaces_org_id_code_unique UNIQUE (org_id, code);


--
-- Name: workplaces workplaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workplaces
    ADD CONSTRAINT workplaces_pkey PRIMARY KEY (id);


--
-- Name: absence_requests_employee_id_date_from_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absence_requests_employee_id_date_from_index ON public.absence_requests USING btree (employee_id, date_from);


--
-- Name: absence_requests_workplace_id_status_date_from_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absence_requests_workplace_id_status_date_from_index ON public.absence_requests USING btree (workplace_id, status, date_from);


--
-- Name: absences_workplace_id_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX absences_workplace_id_date_index ON public.absences USING btree (workplace_id, date);


--
-- Name: attendance_days_employee_id_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_days_employee_id_date_index ON public.attendance_days USING btree (employee_id, date DESC NULLS LAST);


--
-- Name: attendance_days_workplace_id_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_days_workplace_id_date_index ON public.attendance_days USING btree (workplace_id, date);


--
-- Name: audit_log_changed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_changed_at_idx ON public.audit_log USING btree (changed_at DESC);


--
-- Name: audit_log_changed_by_changed_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_changed_by_changed_at_index ON public.audit_log USING btree (changed_by, changed_at DESC NULLS LAST);


--
-- Name: audit_log_table_name_record_id_changed_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_table_name_record_id_changed_at_index ON public.audit_log USING btree (table_name, record_id, changed_at DESC NULLS LAST);


--
-- Name: destructive_action_attempts_ip_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX destructive_action_attempts_ip_created_at_index ON public.destructive_action_attempts USING btree (ip, created_at DESC NULLS LAST) WHERE (success = false);


--
-- Name: destructive_action_attempts_user_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX destructive_action_attempts_user_id_created_at_index ON public.destructive_action_attempts USING btree (user_id, created_at DESC NULLS LAST) WHERE (success = false);


--
-- Name: destructive_action_codes_user_id_target_type_target_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX destructive_action_codes_user_id_target_type_target_id_index ON public.destructive_action_codes USING btree (user_id, target_type, target_id);


--
-- Name: email_otp_attempts_ip_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_otp_attempts_ip_created_at_index ON public.email_otp_attempts USING btree (ip, created_at DESC NULLS LAST) WHERE (success = false);


--
-- Name: email_otp_attempts_user_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_otp_attempts_user_id_created_at_index ON public.email_otp_attempts USING btree (user_id, created_at DESC NULLS LAST) WHERE (success = false);


--
-- Name: email_otp_codes_user_id_session_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_otp_codes_user_id_session_id_index ON public.email_otp_codes USING btree (user_id, session_id);


--
-- Name: employee_availability_rules_employee_id_is_active_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_availability_rules_employee_id_is_active_index ON public.employee_availability_rules USING btree (employee_id, is_active);


--
-- Name: employee_pairings_employee_a_id_is_active_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_pairings_employee_a_id_is_active_index ON public.employee_pairings USING btree (employee_a_id, is_active);


--
-- Name: employee_pairings_employee_b_id_is_active_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employee_pairings_employee_b_id_is_active_index ON public.employee_pairings USING btree (employee_b_id, is_active);


--
-- Name: employees_org_id_is_active_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employees_org_id_is_active_index ON public.employees USING btree (org_id, is_active);


--
-- Name: login_events_email_tried_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_events_email_tried_created_at_index ON public.login_events USING btree (email_tried, created_at DESC NULLS LAST) WHERE (success = false);


--
-- Name: login_events_ip_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_events_ip_created_at_index ON public.login_events USING btree (ip, created_at DESC NULLS LAST) WHERE (success = false);


--
-- Name: login_events_user_id_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_events_user_id_created_at_index ON public.login_events USING btree (user_id, created_at DESC NULLS LAST);


--
-- Name: missing_punch_requests_employee_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX missing_punch_requests_employee_id_date_idx ON public.missing_punch_requests USING btree (employee_id, date);


--
-- Name: notifications_user_id_read_at_created_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_read_at_created_at_index ON public.notifications USING btree (user_id, read_at, created_at DESC NULLS LAST);


--
-- Name: published_shifts_employee_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX published_shifts_employee_id_date_idx ON public.published_shifts USING btree (employee_id, date);


--
-- Name: published_shifts_workplace_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX published_shifts_workplace_id_date_idx ON public.published_shifts USING btree (workplace_id, date);


--
-- Name: punch_events_employee_id_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_events_employee_id_occurred_at_index ON public.punch_events USING btree (employee_id, occurred_at DESC NULLS LAST);


--
-- Name: punch_events_workplace_id_occurred_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_events_workplace_id_occurred_at_index ON public.punch_events USING btree (workplace_id, occurred_at DESC NULLS LAST);


--
-- Name: qr_tokens_expires_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qr_tokens_expires_at_index ON public.qr_tokens USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: schedule_violations_schedule_id_resolved_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_violations_schedule_id_resolved_date_index ON public.schedule_violations USING btree (schedule_id, resolved, date);


--
-- Name: scheduled_shifts_employee_id_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduled_shifts_employee_id_date_index ON public.scheduled_shifts USING btree (employee_id, date);


--
-- Name: scheduled_shifts_workplace_id_date_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduled_shifts_workplace_id_date_index ON public.scheduled_shifts USING btree (workplace_id, date);


--
-- Name: absence_requests absence_requests_materialize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER absence_requests_materialize AFTER INSERT OR UPDATE ON public.absence_requests FOR EACH ROW EXECUTE FUNCTION public.materialize_absence_request();


--
-- Name: absence_requests audit_absences; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_absences AFTER INSERT OR DELETE OR UPDATE ON public.absence_requests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: attendance_days audit_attendance; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_attendance AFTER INSERT OR DELETE OR UPDATE ON public.attendance_days FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: employee_pairings audit_employee_pairings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_employee_pairings AFTER INSERT OR DELETE OR UPDATE ON public.employee_pairings FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: employees audit_employees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_employees AFTER INSERT OR DELETE OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: manager_permissions audit_manager_permissions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_manager_permissions AFTER INSERT OR DELETE OR UPDATE ON public.manager_permissions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: punch_events audit_punch_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_punch_events AFTER DELETE ON public.punch_events FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: punch_events audit_punch_events_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_punch_events_insert AFTER INSERT ON public.punch_events FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: employee_rate_history audit_rates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_rates AFTER INSERT OR DELETE OR UPDATE ON public.employee_rate_history FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: employee_availability_rules audit_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_rules AFTER INSERT OR DELETE OR UPDATE ON public.employee_availability_rules FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: employee_salary_history audit_salary_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_salary_history AFTER INSERT OR DELETE OR UPDATE ON public.employee_salary_history FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: scheduled_shifts audit_shifts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_shifts AFTER INSERT OR DELETE OR UPDATE ON public.scheduled_shifts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--
-- Name: users audit_users_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_users_delete AFTER UPDATE ON public.users FOR EACH ROW WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION public.audit_trigger();


--
-- Name: punch_events trg_punch_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_punch_no_delete BEFORE DELETE ON public.punch_events FOR EACH ROW EXECUTE FUNCTION public.punch_events_immutable();


--
-- Name: punch_events trg_punch_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_punch_no_update BEFORE UPDATE ON public.punch_events FOR EACH ROW EXECUTE FUNCTION public.punch_events_immutable();


--
-- Name: absence_attachments absence_attachments_request_id_absence_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_attachments
    ADD CONSTRAINT absence_attachments_request_id_absence_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.absence_requests(id) ON DELETE CASCADE;


--
-- Name: absence_attachments absence_attachments_uploaded_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_attachments
    ADD CONSTRAINT absence_attachments_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: absence_requests absence_requests_decided_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: absence_requests absence_requests_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: absence_requests absence_requests_requested_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_requested_by_users_id_fk FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: absence_requests absence_requests_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_requests
    ADD CONSTRAINT absence_requests_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: absences absences_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: absences absences_request_id_absence_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_request_id_absence_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.absence_requests(id) ON DELETE CASCADE;


--
-- Name: absences absences_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absences
    ADD CONSTRAINT absences_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: attendance_days attendance_days_corrected_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_days
    ADD CONSTRAINT attendance_days_corrected_by_users_id_fk FOREIGN KEY (corrected_by) REFERENCES public.users(id);


--
-- Name: attendance_days attendance_days_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_days
    ADD CONSTRAINT attendance_days_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: attendance_days attendance_days_scheduled_shift_id_scheduled_shifts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_days
    ADD CONSTRAINT attendance_days_scheduled_shift_id_scheduled_shifts_id_fk FOREIGN KEY (scheduled_shift_id) REFERENCES public.scheduled_shifts(id) ON DELETE SET NULL;


--
-- Name: attendance_days attendance_days_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_days
    ADD CONSTRAINT attendance_days_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: coverage_requirements coverage_requirements_position_id_positions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_requirements
    ADD CONSTRAINT coverage_requirements_position_id_positions_id_fk FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: coverage_requirements coverage_requirements_shift_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_requirements
    ADD CONSTRAINT coverage_requirements_shift_template_id_fkey FOREIGN KEY (shift_template_id) REFERENCES public.shift_templates(id) ON DELETE SET NULL;


--
-- Name: coverage_requirements coverage_requirements_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_requirements
    ADD CONSTRAINT coverage_requirements_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: destructive_action_attempts destructive_action_attempts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destructive_action_attempts
    ADD CONSTRAINT destructive_action_attempts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: destructive_action_codes destructive_action_codes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.destructive_action_codes
    ADD CONSTRAINT destructive_action_codes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_otp_attempts email_otp_attempts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_otp_attempts
    ADD CONSTRAINT email_otp_attempts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_otp_codes email_otp_codes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_otp_codes
    ADD CONSTRAINT email_otp_codes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_availability_rules employee_availability_rules_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_availability_rules
    ADD CONSTRAINT employee_availability_rules_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_availability_rules employee_availability_rules_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_availability_rules
    ADD CONSTRAINT employee_availability_rules_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_availability_rules employee_availability_rules_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_availability_rules
    ADD CONSTRAINT employee_availability_rules_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: employee_pairings employee_pairings_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pairings
    ADD CONSTRAINT employee_pairings_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_pairings employee_pairings_employee_a_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pairings
    ADD CONSTRAINT employee_pairings_employee_a_id_employees_id_fk FOREIGN KEY (employee_a_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_pairings employee_pairings_employee_b_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_pairings
    ADD CONSTRAINT employee_pairings_employee_b_id_employees_id_fk FOREIGN KEY (employee_b_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_position_history employee_position_history_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_position_history
    ADD CONSTRAINT employee_position_history_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_position_history employee_position_history_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_position_history
    ADD CONSTRAINT employee_position_history_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_position_history employee_position_history_position_id_positions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_position_history
    ADD CONSTRAINT employee_position_history_position_id_positions_id_fk FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: employee_rate_history employee_rate_history_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rate_history
    ADD CONSTRAINT employee_rate_history_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_rate_history employee_rate_history_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rate_history
    ADD CONSTRAINT employee_rate_history_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_rate_history employee_rate_history_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rate_history
    ADD CONSTRAINT employee_rate_history_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: employee_salary_history employee_salary_history_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_salary_history
    ADD CONSTRAINT employee_salary_history_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_salary_history employee_salary_history_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_salary_history
    ADD CONSTRAINT employee_salary_history_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_shift_templates employee_shift_templates_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shift_templates
    ADD CONSTRAINT employee_shift_templates_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_shift_templates employee_shift_templates_shift_template_id_shift_templates_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shift_templates
    ADD CONSTRAINT employee_shift_templates_shift_template_id_shift_templates_id_f FOREIGN KEY (shift_template_id) REFERENCES public.shift_templates(id) ON DELETE CASCADE;


--
-- Name: employee_workplaces employee_workplaces_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workplaces
    ADD CONSTRAINT employee_workplaces_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_workplaces employee_workplaces_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workplaces
    ADD CONSTRAINT employee_workplaces_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: employees employees_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employees employees_org_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_org_id_organizations_id_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: employees employees_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: generation_runs generation_runs_triggered_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_runs
    ADD CONSTRAINT generation_runs_triggered_by_users_id_fk FOREIGN KEY (triggered_by) REFERENCES public.users(id);


--
-- Name: generation_runs generation_runs_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generation_runs
    ADD CONSTRAINT generation_runs_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: legal_rules legal_rules_org_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_rules
    ADD CONSTRAINT legal_rules_org_id_organizations_id_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: login_events login_events_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: manager_permissions manager_permissions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_permissions
    ADD CONSTRAINT manager_permissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: manager_permissions manager_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_permissions
    ADD CONSTRAINT manager_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: manager_workplaces manager_workplaces_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_workplaces
    ADD CONSTRAINT manager_workplaces_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: manager_workplaces manager_workplaces_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_workplaces
    ADD CONSTRAINT manager_workplaces_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: missing_punch_requests missing_punch_requests_decided_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missing_punch_requests
    ADD CONSTRAINT missing_punch_requests_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: missing_punch_requests missing_punch_requests_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missing_punch_requests
    ADD CONSTRAINT missing_punch_requests_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: missing_punch_requests missing_punch_requests_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.missing_punch_requests
    ADD CONSTRAINT missing_punch_requests_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: positions positions_org_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_org_id_organizations_id_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: positions positions_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: published_shifts published_shifts_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_shifts
    ADD CONSTRAINT published_shifts_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: published_shifts published_shifts_published_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_shifts
    ADD CONSTRAINT published_shifts_published_by_users_id_fk FOREIGN KEY (published_by) REFERENCES public.users(id);


--
-- Name: published_shifts published_shifts_schedule_id_schedules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_shifts
    ADD CONSTRAINT published_shifts_schedule_id_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;


--
-- Name: published_shifts published_shifts_shift_template_id_shift_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_shifts
    ADD CONSTRAINT published_shifts_shift_template_id_shift_templates_id_fk FOREIGN KEY (shift_template_id) REFERENCES public.shift_templates(id);


--
-- Name: published_shifts published_shifts_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_shifts
    ADD CONSTRAINT published_shifts_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: punch_correction_requests punch_correction_requests_attendance_day_id_attendance_days_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_correction_requests
    ADD CONSTRAINT punch_correction_requests_attendance_day_id_attendance_days_id_ FOREIGN KEY (attendance_day_id) REFERENCES public.attendance_days(id) ON DELETE CASCADE;


--
-- Name: punch_correction_requests punch_correction_requests_decided_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_correction_requests
    ADD CONSTRAINT punch_correction_requests_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: punch_correction_requests punch_correction_requests_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_correction_requests
    ADD CONSTRAINT punch_correction_requests_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: punch_events punch_events_corrects_event_id_punch_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events
    ADD CONSTRAINT punch_events_corrects_event_id_punch_events_id_fk FOREIGN KEY (corrects_event_id) REFERENCES public.punch_events(id);


--
-- Name: punch_events punch_events_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events
    ADD CONSTRAINT punch_events_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: punch_events punch_events_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events
    ADD CONSTRAINT punch_events_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: punch_events punch_events_terminal_id_terminals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events
    ADD CONSTRAINT punch_events_terminal_id_terminals_id_fk FOREIGN KEY (terminal_id) REFERENCES public.terminals(id);


--
-- Name: punch_events punch_events_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_events
    ADD CONSTRAINT punch_events_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: qr_tokens qr_tokens_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_tokens
    ADD CONSTRAINT qr_tokens_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: qr_tokens qr_tokens_used_by_terminal_terminals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_tokens
    ADD CONSTRAINT qr_tokens_used_by_terminal_terminals_id_fk FOREIGN KEY (used_by_terminal) REFERENCES public.terminals(id);


--
-- Name: schedule_violations schedule_violations_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_violations
    ADD CONSTRAINT schedule_violations_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: schedule_violations schedule_violations_generation_run_id_generation_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_violations
    ADD CONSTRAINT schedule_violations_generation_run_id_generation_runs_id_fk FOREIGN KEY (generation_run_id) REFERENCES public.generation_runs(id) ON DELETE CASCADE;


--
-- Name: schedule_violations schedule_violations_position_id_positions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_violations
    ADD CONSTRAINT schedule_violations_position_id_positions_id_fk FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: schedule_violations schedule_violations_schedule_id_schedules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_violations
    ADD CONSTRAINT schedule_violations_schedule_id_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;


--
-- Name: scheduled_shifts scheduled_shifts_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_shifts
    ADD CONSTRAINT scheduled_shifts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: scheduled_shifts scheduled_shifts_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_shifts
    ADD CONSTRAINT scheduled_shifts_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: scheduled_shifts scheduled_shifts_schedule_id_schedules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_shifts
    ADD CONSTRAINT scheduled_shifts_schedule_id_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;


--
-- Name: scheduled_shifts scheduled_shifts_shift_template_id_shift_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_shifts
    ADD CONSTRAINT scheduled_shifts_shift_template_id_shift_templates_id_fk FOREIGN KEY (shift_template_id) REFERENCES public.shift_templates(id);


--
-- Name: scheduled_shifts scheduled_shifts_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_shifts
    ADD CONSTRAINT scheduled_shifts_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: schedules schedules_generated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_generated_by_users_id_fk FOREIGN KEY (generated_by) REFERENCES public.users(id);


--
-- Name: schedules schedules_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: shift_leader_assignments shift_leader_assignments_decided_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_leader_assignments
    ADD CONSTRAINT shift_leader_assignments_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: shift_leader_assignments shift_leader_assignments_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_leader_assignments
    ADD CONSTRAINT shift_leader_assignments_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: shift_leader_assignments shift_leader_assignments_position_id_positions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_leader_assignments
    ADD CONSTRAINT shift_leader_assignments_position_id_positions_id_fk FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: shift_leader_assignments shift_leader_assignments_schedule_id_schedules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_leader_assignments
    ADD CONSTRAINT shift_leader_assignments_schedule_id_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;


--
-- Name: shift_leader_assignments shift_leader_assignments_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_leader_assignments
    ADD CONSTRAINT shift_leader_assignments_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id);


--
-- Name: shift_templates shift_templates_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_templates
    ADD CONSTRAINT shift_templates_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: terminals terminals_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: users users_org_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_id_organizations_id_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: vacation_balances vacation_balances_employee_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacation_balances
    ADD CONSTRAINT vacation_balances_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: workplace_closures workplace_closures_workplace_id_workplaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workplace_closures
    ADD CONSTRAINT workplace_closures_workplace_id_workplaces_id_fk FOREIGN KEY (workplace_id) REFERENCES public.workplaces(id) ON DELETE CASCADE;


--
-- Name: workplaces workplaces_org_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workplaces
    ADD CONSTRAINT workplaces_org_id_organizations_id_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: absence_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.absence_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: absence_attachments absence_attachments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absence_attachments_delete ON public.absence_attachments FOR DELETE USING (public.is_owner());


--
-- Name: absence_attachments absence_attachments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absence_attachments_insert ON public.absence_attachments FOR INSERT WITH CHECK ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.absence_requests ar
  WHERE ((ar.id = absence_attachments.request_id) AND ((ar.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) OR (ar.employee_id = public.current_employee_id())))))));


--
-- Name: absence_attachments absence_attachments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absence_attachments_select ON public.absence_attachments FOR SELECT USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.absence_requests ar
  WHERE ((ar.id = absence_attachments.request_id) AND ((ar.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) OR (ar.employee_id = public.current_employee_id())))))));


--
-- Name: absence_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.absence_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: absence_requests absence_requests_delete_confirmed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absence_requests_delete_confirmed ON public.absence_requests FOR DELETE USING ((public.is_owner() AND (employee_id = (NULLIF(current_setting('app.confirmed_employee_delete_id'::text, true), ''::text))::uuid)));


--
-- Name: absences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;

--
-- Name: absences absences_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absences_select ON public.absences FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) OR (employee_id = public.current_employee_id())));


--
-- Name: absences absences_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY absences_write ON public.absences USING (((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))) WITH CHECK (((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: attendance_days att_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY att_select ON public.attendance_days FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) OR (employee_id = public.current_employee_id())));


--
-- Name: attendance_days att_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY att_write ON public.attendance_days FOR UPDATE USING (((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) AND (is_locked = false)));


--
-- Name: attendance_days; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_days attendance_days_delete_confirmed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_days_delete_confirmed ON public.attendance_days FOR DELETE USING ((public.is_owner() AND (employee_id = (NULLIF(current_setting('app.confirmed_employee_delete_id'::text, true), ''::text))::uuid)));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select_owner ON public.audit_log FOR SELECT USING ((public.is_owner() AND (org_id = public.current_user_org_id())));


--
-- Name: coverage_requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coverage_requirements ENABLE ROW LEVEL SECURITY;

--
-- Name: coverage_requirements coverage_requirements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coverage_requirements_select ON public.coverage_requirements FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: coverage_requirements coverage_requirements_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coverage_requirements_write ON public.coverage_requirements USING ((public.has_manager_permission('manage_rules'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id()))))) WITH CHECK ((public.has_manager_permission('manage_rules'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id())))));


--
-- Name: destructive_action_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.destructive_action_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: destructive_action_attempts destructive_action_attempts_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY destructive_action_attempts_select_owner ON public.destructive_action_attempts FOR SELECT USING ((public.is_owner() AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = destructive_action_attempts.user_id) AND (u.org_id = public.current_user_org_id()))))));


--
-- Name: destructive_action_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.destructive_action_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: email_otp_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_otp_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: email_otp_attempts email_otp_attempts_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_otp_attempts_select_owner ON public.email_otp_attempts FOR SELECT USING ((public.is_owner() AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = email_otp_attempts.user_id) AND (u.org_id = public.current_user_org_id()))))));


--
-- Name: email_otp_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_otp_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: employees emp_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY emp_select ON public.employees FOR SELECT USING ((public.is_owner() OR (id = public.current_employee_id()) OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employees.id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))));


--
-- Name: employees emp_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY emp_write ON public.employees USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employees.id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: employee_availability_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_availability_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_pairings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_pairings ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_pairings employee_pairings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_pairings_select ON public.employee_pairings FOR SELECT USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_pairings.employee_a_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_pairings.employee_b_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) OR (employee_a_id = public.current_employee_id()) OR (employee_b_id = public.current_employee_id())));


--
-- Name: employee_pairings employee_pairings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_pairings_write ON public.employee_pairings USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_pairings.employee_a_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_pairings.employee_b_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_pairings.employee_a_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_pairings.employee_b_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: employee_position_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_position_history ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_position_history employee_position_history_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_position_history_select ON public.employee_position_history FOR SELECT USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_position_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))));


--
-- Name: employee_position_history employee_position_history_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_position_history_write ON public.employee_position_history USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_position_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_position_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: employee_rate_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_rate_history ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_salary_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_salary_history ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_shift_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_shift_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_shift_templates employee_shift_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_shift_templates_select ON public.employee_shift_templates FOR SELECT USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.shift_templates st
  WHERE ((st.id = employee_shift_templates.shift_template_id) AND (st.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))));


--
-- Name: employee_shift_templates employee_shift_templates_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_shift_templates_write ON public.employee_shift_templates USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.shift_templates st
  WHERE ((st.id = employee_shift_templates.shift_template_id) AND (st.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.shift_templates st
  WHERE ((st.id = employee_shift_templates.shift_template_id) AND (st.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: employee_workplaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_workplaces ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_workplaces employee_workplaces_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_workplaces_select ON public.employee_workplaces FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: employee_workplaces employee_workplaces_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_workplaces_write ON public.employee_workplaces USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))));


--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: employees employees_insert_manager; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_insert_manager ON public.employees FOR INSERT WITH CHECK (((public.current_user_role() = 'manager'::public.user_role) AND (org_id = public.current_user_org_id())));


--
-- Name: generation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: generation_runs generation_runs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY generation_runs_select ON public.generation_runs FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: generation_runs generation_runs_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY generation_runs_write ON public.generation_runs USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))));


--
-- Name: holidays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: holidays holidays_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY holidays_select ON public.holidays FOR SELECT USING ((public.current_user_id() IS NOT NULL));


--
-- Name: holidays holidays_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY holidays_write ON public.holidays USING (public.is_owner()) WITH CHECK (public.is_owner());


--
-- Name: legal_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_rules legal_rules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_rules_select ON public.legal_rules FOR SELECT USING ((org_id = public.current_user_org_id()));


--
-- Name: legal_rules legal_rules_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY legal_rules_write ON public.legal_rules USING ((public.has_manager_permission('manage_rules'::text) AND (org_id = public.current_user_org_id()))) WITH CHECK ((public.has_manager_permission('manage_rules'::text) AND (org_id = public.current_user_org_id())));


--
-- Name: login_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;

--
-- Name: login_events login_events_select_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY login_events_select_owner ON public.login_events FOR SELECT USING ((public.is_owner() AND ((user_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = login_events.user_id) AND (u.org_id = public.current_user_org_id())))))));


--
-- Name: manager_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_permissions manager_permissions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY manager_permissions_select ON public.manager_permissions FOR SELECT USING (((public.is_owner() AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = manager_permissions.user_id) AND (u.org_id = public.current_user_org_id()))))) OR (user_id = public.current_user_id())));


--
-- Name: manager_permissions manager_permissions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY manager_permissions_write ON public.manager_permissions USING ((public.is_owner() AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = manager_permissions.user_id) AND (u.org_id = public.current_user_org_id()) AND (u.role = 'manager'::public.user_role)))))) WITH CHECK ((public.is_owner() AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = manager_permissions.user_id) AND (u.org_id = public.current_user_org_id()) AND (u.role = 'manager'::public.user_role))))));


--
-- Name: manager_workplaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_workplaces ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_workplaces manager_workplaces_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY manager_workplaces_select ON public.manager_workplaces FOR SELECT USING ((public.is_owner() OR (user_id = public.current_user_id())));


--
-- Name: manager_workplaces manager_workplaces_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY manager_workplaces_write ON public.manager_workplaces USING (public.is_owner()) WITH CHECK (public.is_owner());


--
-- Name: missing_punch_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.missing_punch_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: missing_punch_requests missing_punch_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY missing_punch_requests_insert ON public.missing_punch_requests FOR INSERT WITH CHECK ((public.is_owner() OR (employee_id = public.current_employee_id())));


--
-- Name: missing_punch_requests missing_punch_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY missing_punch_requests_select ON public.missing_punch_requests FOR SELECT USING ((public.is_owner() OR (employee_id = public.current_employee_id()) OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: missing_punch_requests missing_punch_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY missing_punch_requests_update ON public.missing_punch_requests FOR UPDATE USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))));


--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences notification_preferences_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_own ON public.notification_preferences USING ((user_id = public.current_user_id())) WITH CHECK ((user_id = public.current_user_id()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_own ON public.notifications USING ((user_id = public.current_user_id())) WITH CHECK ((user_id = public.current_user_id()));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_select ON public.organizations FOR SELECT USING ((public.current_user_id() IS NOT NULL));


--
-- Name: organizations organizations_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_write ON public.organizations USING ((public.is_owner() AND (id = public.current_user_org_id()))) WITH CHECK ((public.is_owner() AND (id = public.current_user_org_id())));


--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: positions positions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY positions_select ON public.positions FOR SELECT USING ((org_id = public.current_user_org_id()));


--
-- Name: positions positions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY positions_write ON public.positions USING ((public.has_manager_permission('manage_positions_shifts'::text) AND (org_id = public.current_user_org_id()))) WITH CHECK ((public.has_manager_permission('manage_positions_shifts'::text) AND (org_id = public.current_user_org_id())));


--
-- Name: published_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.published_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: published_shifts published_shifts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY published_shifts_select ON public.published_shifts FOR SELECT USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))) OR (employee_id = public.current_employee_id())));


--
-- Name: published_shifts published_shifts_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY published_shifts_write ON public.published_shifts USING (((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: punch_correction_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.punch_correction_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: punch_correction_requests punch_correction_requests_delete_confirmed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY punch_correction_requests_delete_confirmed ON public.punch_correction_requests FOR DELETE USING ((public.is_owner() AND (employee_id = (NULLIF(current_setting('app.confirmed_employee_delete_id'::text, true), ''::text))::uuid)));


--
-- Name: punch_correction_requests punch_correction_requests_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY punch_correction_requests_insert ON public.punch_correction_requests FOR INSERT WITH CHECK ((public.is_owner() OR (employee_id = public.current_employee_id())));


--
-- Name: punch_correction_requests punch_correction_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY punch_correction_requests_select ON public.punch_correction_requests FOR SELECT USING ((public.is_owner() OR (employee_id = public.current_employee_id()) OR (EXISTS ( SELECT 1
   FROM public.attendance_days ad
  WHERE ((ad.id = punch_correction_requests.attendance_day_id) AND (ad.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))));


--
-- Name: punch_correction_requests punch_correction_requests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY punch_correction_requests_update ON public.punch_correction_requests FOR UPDATE USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.attendance_days ad
  WHERE ((ad.id = punch_correction_requests.attendance_day_id) AND (ad.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: punch_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.punch_events ENABLE ROW LEVEL SECURITY;

--
-- Name: punch_events punch_events_delete_confirmed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY punch_events_delete_confirmed ON public.punch_events FOR DELETE USING ((public.is_owner() AND (employee_id = (NULLIF(current_setting('app.confirmed_employee_delete_id'::text, true), ''::text))::uuid)));


--
-- Name: punch_events punch_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY punch_select ON public.punch_events FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) OR (employee_id = public.current_employee_id())));


--
-- Name: qr_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_tokens qr_tokens_delete_confirmed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qr_tokens_delete_confirmed ON public.qr_tokens FOR DELETE USING ((public.is_owner() AND (employee_id = (NULLIF(current_setting('app.confirmed_employee_delete_id'::text, true), ''::text))::uuid)));


--
-- Name: qr_tokens qr_tokens_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qr_tokens_insert_own ON public.qr_tokens FOR INSERT WITH CHECK ((employee_id = public.current_employee_id()));


--
-- Name: qr_tokens qr_tokens_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qr_tokens_select_own ON public.qr_tokens FOR SELECT USING ((employee_id = public.current_employee_id()));


--
-- Name: employee_rate_history rate_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rate_select ON public.employee_rate_history FOR SELECT USING ((public.is_owner() OR (public.current_user_role() = 'accountant'::public.user_role) OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_rate_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) AND (public.current_user_role() = 'manager'::public.user_role) AND public.has_manager_permission('view_wages'::text)))) OR (employee_id = public.current_employee_id())));


--
-- Name: employee_rate_history rate_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rate_write ON public.employee_rate_history USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_rate_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) AND (public.current_user_role() = 'manager'::public.user_role) AND public.has_manager_permission('edit_wages'::text)))))) WITH CHECK ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_rate_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) AND (public.current_user_role() = 'manager'::public.user_role) AND public.has_manager_permission('edit_wages'::text))))));


--
-- Name: absence_requests req_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY req_insert ON public.absence_requests FOR INSERT WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))) OR (employee_id = public.current_employee_id())));


--
-- Name: absence_requests req_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY req_select ON public.absence_requests FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) OR (employee_id = public.current_employee_id())));


--
-- Name: absence_requests req_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY req_update ON public.absence_requests FOR UPDATE USING ((((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))) OR ((employee_id = public.current_employee_id()) AND (status = 'pending'::public.request_status)))) WITH CHECK ((((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))) OR ((employee_id = public.current_employee_id()) AND (status = ANY (ARRAY['pending'::public.request_status, 'cancelled'::public.request_status])))));


--
-- Name: employee_availability_rules rules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rules_select ON public.employee_availability_rules FOR SELECT USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_availability_rules.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) OR (employee_id = public.current_employee_id())));


--
-- Name: employee_availability_rules rules_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rules_write ON public.employee_availability_rules USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_availability_rules.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: employee_salary_history salary_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY salary_select ON public.employee_salary_history FOR SELECT USING ((public.is_owner() OR (public.current_user_role() = 'accountant'::public.user_role) OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_salary_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) AND (public.current_user_role() = 'manager'::public.user_role) AND public.has_manager_permission('view_wages'::text)))) OR (employee_id = public.current_employee_id())));


--
-- Name: employee_salary_history salary_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY salary_write ON public.employee_salary_history USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_salary_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) AND (public.current_user_role() = 'manager'::public.user_role) AND public.has_manager_permission('edit_wages'::text)))))) WITH CHECK ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = employee_salary_history.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) AND (public.current_user_role() = 'manager'::public.user_role) AND public.has_manager_permission('edit_wages'::text))))));


--
-- Name: scheduled_shifts sched_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_select ON public.scheduled_shifts FOR SELECT USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))) OR ((employee_id = public.current_employee_id()) AND (EXISTS ( SELECT 1
   FROM public.schedules s
  WHERE ((s.id = scheduled_shifts.schedule_id) AND (s.status = 'published'::public.schedule_status)))))));


--
-- Name: scheduled_shifts sched_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_write ON public.scheduled_shifts USING (((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: schedule_violations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_violations ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_violations schedule_violations_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedule_violations_write ON public.schedule_violations USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.schedules s
  WHERE ((s.id = schedule_violations.schedule_id) AND (s.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.schedules s
  WHERE ((s.id = schedule_violations.schedule_id) AND (s.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: scheduled_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scheduled_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: schedules schedules_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedules_select ON public.schedules FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: schedules schedules_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schedules_write ON public.schedules USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))));


--
-- Name: shift_leader_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_leader_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_leader_assignments shift_leader_assignments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_leader_assignments_select ON public.shift_leader_assignments FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)) OR (employee_id = public.current_employee_id())));


--
-- Name: shift_leader_assignments shift_leader_assignments_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_leader_assignments_write ON public.shift_leader_assignments USING (((public.is_owner() OR (public.current_user_role() = 'manager'::public.user_role)) AND (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: shift_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_templates shift_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_templates_select ON public.shift_templates FOR SELECT USING ((public.is_owner() OR (workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))));


--
-- Name: shift_templates shift_templates_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shift_templates_write ON public.shift_templates USING ((public.has_manager_permission('manage_positions_shifts'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id()))))) WITH CHECK ((public.has_manager_permission('manage_positions_shifts'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id())))));


--
-- Name: terminals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.terminals ENABLE ROW LEVEL SECURITY;

--
-- Name: terminals terminals_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY terminals_write ON public.terminals USING ((public.has_manager_permission('manage_terminals'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id()))))) WITH CHECK ((public.has_manager_permission('manage_terminals'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id())))));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_manager; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_manager ON public.users FOR INSERT WITH CHECK (((public.current_user_role() = 'manager'::public.user_role) AND (org_id = public.current_user_org_id()) AND ((role = 'employee'::public.user_role) OR ((role = ANY (ARRAY['manager'::public.user_role, 'accountant'::public.user_role])) AND public.has_manager_permission('manage_accounts'::text)))));


--
-- Name: users users_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select ON public.users FOR SELECT USING (((id = public.current_user_id()) OR (public.is_owner() AND (org_id = public.current_user_org_id()))));


--
-- Name: users users_select_manage_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_manage_accounts ON public.users FOR SELECT USING ((public.has_manager_permission('manage_accounts'::text) AND (org_id = public.current_user_org_id()) AND (role = ANY (ARRAY['manager'::public.user_role, 'accountant'::public.user_role, 'employee'::public.user_role]))));


--
-- Name: users users_select_manager; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_manager ON public.users FOR SELECT USING (((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM (public.employees e
     JOIN public.employee_workplaces ew ON ((ew.employee_id = e.id)))
  WHERE ((e.user_id = users.id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))));


--
-- Name: users users_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_self_update ON public.users FOR UPDATE USING ((id = public.current_user_id())) WITH CHECK (((id = public.current_user_id()) AND (EXISTS ( SELECT 1
   FROM public.stored_user_row(users.id) old(id, org_id, auth_user_id, email, role, full_name, is_active, invited_at, activated_at, last_login_at, created_at)
  WHERE ((old.org_id = users.org_id) AND (NOT (old.auth_user_id IS DISTINCT FROM users.auth_user_id)) AND (old.email OPERATOR(public.=) users.email) AND (old.role = users.role) AND (old.full_name = users.full_name) AND (old.is_active = users.is_active) AND (NOT (old.invited_at IS DISTINCT FROM users.invited_at)) AND (old.created_at = users.created_at))))));


--
-- Name: users users_update_manage_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_manage_accounts ON public.users FOR UPDATE USING ((public.has_manager_permission('manage_accounts'::text) AND (role = 'employee'::public.user_role) AND (org_id = public.current_user_org_id()))) WITH CHECK ((public.has_manager_permission('manage_accounts'::text) AND (role = 'employee'::public.user_role) AND (org_id = public.current_user_org_id())));


--
-- Name: users users_write_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_write_owner ON public.users USING ((public.is_owner() AND (org_id = public.current_user_org_id()))) WITH CHECK ((public.is_owner() AND (org_id = public.current_user_org_id())));


--
-- Name: vacation_balances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vacation_balances ENABLE ROW LEVEL SECURITY;

--
-- Name: vacation_balances vacation_balances_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vacation_balances_select ON public.vacation_balances FOR SELECT USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = vacation_balances.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))));


--
-- Name: vacation_balances vacation_balances_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vacation_balances_write ON public.vacation_balances USING ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = vacation_balances.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))))) WITH CHECK ((public.is_owner() OR ((public.current_user_role() = 'manager'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.employee_workplaces ew
  WHERE ((ew.employee_id = vacation_balances.employee_id) AND (ew.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces))))))));


--
-- Name: schedule_violations viol_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY viol_select ON public.schedule_violations FOR SELECT USING ((public.is_owner() OR (EXISTS ( SELECT 1
   FROM public.schedules s
  WHERE ((s.id = schedule_violations.schedule_id) AND (s.workplace_id IN ( SELECT public.accessible_workplaces() AS accessible_workplaces)))))));


--
-- Name: workplace_closures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workplace_closures ENABLE ROW LEVEL SECURITY;

--
-- Name: workplace_closures workplace_closures_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workplace_closures_select ON public.workplace_closures FOR SELECT USING ((workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id()))));


--
-- Name: workplace_closures workplace_closures_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workplace_closures_write ON public.workplace_closures USING ((public.has_manager_permission('manage_rules'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id()))))) WITH CHECK ((public.has_manager_permission('manage_rules'::text) AND (workplace_id IN ( SELECT workplaces.id
   FROM public.workplaces
  WHERE (workplaces.org_id = public.current_user_org_id())))));


--
-- Name: workplaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workplaces ENABLE ROW LEVEL SECURITY;

--
-- Name: workplaces workplaces_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workplaces_select ON public.workplaces FOR SELECT USING ((org_id = public.current_user_org_id()));


--
-- Name: workplaces workplaces_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workplaces_write ON public.workplaces USING ((public.is_owner() AND (org_id = public.current_user_org_id()))) WITH CHECK ((public.is_owner() AND (org_id = public.current_user_org_id())));


--
-- PostgreSQL database dump complete
--

\unrestrict 1fhi2km0KCoEPVRJNdw5jtr8z3fo9RBc6iJpFILicCZZhbO4eA789EpYs8pxiNi

