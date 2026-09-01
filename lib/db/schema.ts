import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Case-insensitive text (vyžaduje `CREATE EXTENSION citext` — pozri migrations/0001_raw.sql)
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

// ============================================================================
// 1. ORGANIZÁCIA A PREVÁDZKY
// ============================================================================

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ico: text("ico"),
  // Kontakt (Blok 13) — "podpora" nie je viazaná na žiadne konto v systéme
  // (dodávateľ/údržba appky, nie zamestnanec organizácie), preto sa
  // vypĺňa ručne v Nastavenia → Kontá, nie odvodzuje z `users`.
  supportName: text("support_name"),
  supportEmail: text("support_email"),
  supportPhone: text("support_phone"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workplaces = pgTable(
  "workplaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    timezone: text("timezone").notNull().default("Europe/Bratislava"),

    operatingDays: smallint("operating_days")
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5,6,7}'`),
    operatesHolidays: boolean("operates_holidays").notNull().default(true),

    gpsLat: numeric("gps_lat", { precision: 10, scale: 7 }),
    gpsLng: numeric("gps_lng", { precision: 10, scale: 7 }),
    gpsRadiusM: integer("gps_radius_m").default(150),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.code)],
);

export const workplaceClosures = pgTable(
  "workplace_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.workplaceId, t.date)],
);

export const holidays = pgTable("holidays", {
  date: date("date").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull().default("SK"),
});

// ============================================================================
// 2. POUŽÍVATELIA, ROLE, PRÍSTUPY
// ============================================================================

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "manager",
  "employee",
  "accountant",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authUserId: uuid("auth_user_id").unique(),
    // Nullable — zámazané konto (viď `deletedAt`) má email vynulovaný, aby sa
    // adresa uvoľnila pre prípadnú novú pozvánku (UNIQUE(org_id, email) nižšie).
    email: citext("email"),
    role: userRoleEnum("role").notNull(),
    fullName: text("full_name").notNull(),
    // Kontakt (Blok 13) — owner/manager kontá nemajú `employees` riadok (tam
    // je telefón zamestnancov), takže bez tohto stĺpca by nemali telefón
    // uložený vôbec nikde. Voliteľné, dopĺňa sa v Nastavenia → Kontá.
    phone: text("phone"),

    isActive: boolean("is_active").notNull().default(true),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // Nastavenia → Kontá, zmazanie konta — soft-delete (dôvod pozri
    // migrácia 0044: fyzický DELETE blokuje `punch_events.created_by` a
    // append-only trigger by aj tak nedovolil obísť to cez ON DELETE SET
    // NULL). `users` riadok OSTÁVA ako kotva pre históriu, len sa mu
    // vynuluje prihlasovacia identita (authUserId, email → NULL,
    // isActive → false). Filtruj `deletedAt IS NULL` všade, kde sa má
    // zmazané konto správať, akoby neexistovalo (zoznam kont, výber
    // manažéra a pod.).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.email)],
);

export const managerWorkplaces = pgTable(
  "manager_workplaces",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workplaceId] })],
);

// Granulárne pravomoci manažérov — balíčky (nie mikro-práva), PER MANAŽÉR
// (nie per prevádzka, na rozdiel od manager_workplaces vyššie). ŽIADNY
// RIADOK = dnešné manažérske práva (bezpečná spätná kompatibilita — pozri
// has_manager_permission() v migrácii 0047, defaulty MUSIA sedieť s
// stĺpcovými defaultmi nižšie). "Prístup do Nastavení" je ODVODENÝ (aspoň
// jeden z manage_* balíčkov zapnutý), nemá vlastný stĺpec — viď
// lib/auth/manager-permissions.ts::hasSettingsAccess.
//
// ANTI-ESKALÁCIA (kritické): editovanie TEJTO tabuľky je RLS-vynútené
// owner-only, bez výnimky a bez balíčkovej vetvy (migrácia 0047,
// manager_permissions_write) — manažér nikdy nesmie zmeniť vlastné ani
// cudzie pravomoci, aj keby mal `manage_accounts`. NEROZŠIRUJ toto pravidlo.
export const managerPermissions = pgTable("manager_permissions", {
  // Surogátne id (nie userId ako PK) — generický audit_trigger() číta
  // NEW.id/OLD.id, čo pri PK bez stĺpca `id` (ako manager_workplaces vyššie)
  // zlyhá za behu. userId ostáva UNIQUE (1 riadok na manažéra).
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  managePositionsShifts: boolean("manage_positions_shifts").notNull().default(false),
  manageRules: boolean("manage_rules").notNull().default(false),
  manageAccounts: boolean("manage_accounts").notNull().default(false),
  viewWages: boolean("view_wages").notNull().default(true),
  editWages: boolean("edit_wages").notNull().default(false),
  manageTerminals: boolean("manage_terminals").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const loginEvents = pgTable(
  "login_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    emailTried: citext("email_tried"),
    success: boolean("success").notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index().on(t.userId, t.createdAt.desc()),
    // Rate limiting (lib/auth/rate-limit.ts) číta presne tieto dva vzory —
    // bez indexov to bol pri raste tabuľky sekvenčný scan na každé
    // prihlásenie. Čiastočné indexy (len success=false), lebo rate limit
    // počíta výhradne neúspešné pokusy.
    index()
      .on(t.emailTried, t.createdAt.desc())
      .where(sql`${t.success} = false`),
    index()
      .on(t.ip, t.createdAt.desc())
      .where(sql`${t.success} = false`),
  ],
);

// ---------------------------------------------------------------------------
// 2FA (owner-only, email kód namiesto TOTP) — nahrádza Supabase auth.mfa
// (TOTP autentifikátor) jednorazovým 6-miestnym kódom poslaným mailom cez
// Resend. `session_id` je claim zo Supabase JWT (rovnaký po celú dobu jednej
// prihlásenej session, mení sa len pri novom prihlásení) — kód/overenie je
// naviazané naň, nie na `users.id` samotné, aby platilo "over raz za
// session", nie "over raz navždy" ani "over pri každom requeste".
// `email_otp_codes` nesie SAMOTNÉ kódy (hash, expirácia, jednorazovosť) —
// `REVOKE ALL ... FROM app_user` (migrácia), keďže niet legitímny dôvod, aby
// ich appka niekedy čítala cez bežnú (RLS) cestu, len cez adminDb
// (lib/auth/email-otp.ts). `email_otp_attempts` je samostatný log POKUSOV
// o overenie (úspešných aj neúspešných) — na rate limiting rovnakým vzorom
// ako `login_events` (lib/auth/rate-limit.ts), zámerne oddelený od
// `email_otp_codes`, lebo rate limit musí vidieť pokusy naprieč VIACERÝMI
// vydanými kódmi toho istého človeka, nie len počítadlo na jednom riadku.
// ---------------------------------------------------------------------------
export const emailOtpCodes = pgTable(
  "email_otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index().on(t.userId, t.sessionId)],
);

export const emailOtpAttempts = pgTable(
  "email_otp_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    success: boolean("success").notNull(),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Rate limiting (lib/auth/email-otp-rate-limit.ts) číta presne tieto dva
    // vzory — čiastočné indexy (len success=false), rovnaké zdôvodnenie ako
    // login_events vyššie.
    index()
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.success} = false`),
    index()
      .on(t.ip, t.createdAt.desc())
      .where(sql`${t.success} = false`),
  ],
);

// ---------------------------------------------------------------------------
// Blok 14 — mazanie konfigurácie/zamestnancov, potvrdené e-mailovým kódom.
// Rovnaký vzor ako email_otp_codes/email_otp_attempts vyššie (2FA), ale
// ZÁMERNE samostatné tabuľky — zdieľanie s prihlasovacím 2FA by znamenalo, že
// séria neúspešných potvrdení mazania môže zamknúť majiteľa aj z PRIHLÁSENIA.
// `targetType` je enum (nie text ako `notifications.kind`) — toto je
// bezpečnostný zoznam TOHO, čo sa vôbec dá takto zmazať, nie voľne
// rozšíriteľný zoznam typov udalostí; nový typ nech vyžaduje migráciu.
// ---------------------------------------------------------------------------
export const destructiveActionTargetEnum = pgEnum("destructive_action_target", [
  "legal_rule",
  "coverage_requirement",
  "shift_template",
  "position",
  "workplace",
  "employee",
  "user_account",
]);

export const destructiveActionCodes = pgTable(
  "destructive_action_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: destructiveActionTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index().on(t.userId, t.targetType, t.targetId)],
);

export const destructiveActionAttempts = pgTable(
  "destructive_action_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    success: boolean("success").notNull(),
    ip: inet("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index()
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.success} = false`),
    index()
      .on(t.ip, t.createdAt.desc())
      .where(sql`${t.success} = false`),
  ],
);

// ============================================================================
// 3. ZAMESTNANCI
// ============================================================================

// Blok A1 (turnusový pracovný čas, §87 ZP) — `rovnomerny` = dnešné jediné
// správanie (MAX_WEEKLY_HOURS tvrdo na KAŽDÝ ISO týždeň); `nerovnomerny_turnus`
// = kontroluje sa priemer za vyrovnávacie obdobie, jednotlivý týždeň smie
// stropu prekročiť. Viď lib/scheduler/work-time-mode.ts.
export const workTimeModeEnum = pgEnum("work_time_mode", ["rovnomerny", "nerovnomerny_turnus"]);

// Pípanie prestávok, krok 1 — šablóna zmeny nesie prestávku buď ako počet
// minút (default, dnešné správanie), alebo ako presný čas od–do. Viď
// lib/shared/break-config.ts pre výpočet efektívneho počtu minút.
export const breakConfigModeEnum = pgEnum("break_config_mode", ["minuty", "presny_cas"]);

// Pípanie prestávok, krok 2 — kto si prestávky reálne pípa vs. kto má
// prestávku vždy automaticky zo šablóny/priradenia. Rovnaký vzor ako
// work_time_mode: default na pozícii, prepísateľné na zamestnancovi (NULL =
// zdedené). Viď lib/scheduler/break-tracking-mode.ts.
export const breakTrackingModeEnum = pgEnum("break_tracking_mode", ["automaticky", "pipa"]);

// Režim odchodu — default na pozícii, prepísateľný na zamestnancovi (NULL =
// zdedené). Rovnaký vzor ako break_tracking_mode vyššie, ale rieši VÝHRADNE
// odchod (koniec zmeny), nie prestávky. Viď lib/scheduler/departure-mode.ts.
export const departureModeEnum = pgEnum("departure_mode", ["pipa", "nepipa"]);

// Fixný plat — default na pozícii, prepísateľné na zamestnancovi (NULL =
// zdedené), PRESNE vzor break_tracking_mode vyššie (nie work_time_mode — ten
// je výhradne na zamestnancovi bez dedenia, vedome opustený vzor). "hodinovy"
// = dnešné jediné správanie (mzda = odpracované hodiny × sadzba,
// employee_rate_history/getRateAt, nezmenené). "fixny" = mzda = fix +
// variabilná (employee_salary_history/getSalaryAt nižšie), NEPOČÍTA sa z
// hodín — tie sa aj tak ďalej evidujú (informačne vo výkaze). Viď
// lib/payroll/resolve-pay-mode.ts.
export const payModeEnum = pgEnum("pay_mode", ["hodinovy", "fixny"]);

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    personalNumber: text("personal_number"),
    phone: text("phone"),
    email: citext("email"),

    hiredOn: date("hired_on").notNull(),
    terminatedOn: date("terminated_on"),

    contractHoursPerMonth: numeric("contract_hours_per_month", {
      precision: 5,
      scale: 2,
    }),
    contractType: text("contract_type"),

    vacationDaysPerYear: numeric("vacation_days_per_year", {
      precision: 5,
      scale: 2,
    }).default("20"),
    vacationCarriedOver: numeric("vacation_carried_over", {
      precision: 5,
      scale: 2,
    }).default("0"),

    avatarColor: text("avatar_color"),
    notes: text("notes"),

    // Blok A1 (§87 ZP) — VÝHRADNE na zamestnancovi, pozícia už do tohto vôbec
    // nehovorí (predošlý "prepis pozície" vzor zámerne opustený — klient chce
    // režim čisto individuálny, nie odvodený). NOT NULL — každý zamestnanec
    // má vždy nejakú konkrétnu hodnotu, default zachováva dnešné správanie.
    workTimeMode: workTimeModeEnum("work_time_mode").notNull().default("rovnomerny"),
    balancingPeriodMonths: integer("balancing_period_months").notNull().default(4),

    // Pípanie prestávok, krok 2 — prepíše positions.break_tracking_mode pre
    // TOHTO zamestnanca. NULL = zdedené z pozície (rovnaký vzor ako
    // override_work_time_mode vyššie). Viď lib/scheduler/break-tracking-mode.ts.
    overrideBreakTrackingMode: breakTrackingModeEnum("override_break_tracking_mode"),

    // Fixný plat — prepíše positions.pay_mode pre TOHTO zamestnanca. NULL =
    // zdedené z pozície (rovnaký vzor ako override_break_tracking_mode
    // vyššie). Viď lib/payroll/resolve-pay-mode.ts.
    overridePayMode: payModeEnum("override_pay_mode"),

    // Režim odchodu — prepíše positions.departure_mode pre TOHTO zamestnanca.
    // NULL = zdedené z pozície (rovnaký vzor ako override_break_tracking_mode
    // vyššie). Viď lib/scheduler/departure-mode.ts.
    overrideDepartureMode: departureModeEnum("override_departure_mode"),

    // Web-pípanie tlačidlom (home office) — DEFAULT VYPNUTÉ. Bez tohto
    // súhlasu web-punch-button.tsx tlačidlo vôbec nezobrazí a
    // POST /api/punch/web ho aj tak nezávisle overí (rovnaká 2-vrstvová
    // obrana ako inde: UI skrytie + serverová kontrola).
    canPunchWeb: boolean("can_punch_web").notNull().default(false),

    // Vedúci smeny — spôsobilosť KONKRÉTNEHO ČLOVEKA byť vedúcim (napr.
    // brigádnik nie). Čistý nezávislý flag, ŽIADNA dedičnosť z pozície (na
    // rozdiel od override_break_tracking_mode vyššie) — pozícia len hovorí ČI
    // vedúceho vôbec potrebuje (positions.requires_shift_leader), toto hovorí
    // KTO ním smie byť.
    canBeShiftLeader: boolean("can_be_shift_leader").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [index().on(t.orgId, t.isActive)],
);

export const employeeWorkplaces = pgTable(
  "employee_workplaces",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.workplaceId] })],
);

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  workplaceId: uuid("workplace_id").references(() => workplaces.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  color: text("color"),
  isActive: boolean("is_active").notNull().default(true),

  // Pípanie prestávok, krok 2 — default pre všetkých na tejto pozícii, kto si
  // reálne pípa prestávky ("pipa") vs. komu sa vždy odpočíta zo šablóny
  // ("automaticky", default zachováva PRESNE dnešné správanie). Zamestnanec ho
  // smie prepísať (employees.override_break_tracking_mode).
  breakTrackingMode: breakTrackingModeEnum("break_tracking_mode").notNull().default("automaticky"),

  // Fixný plat — default pre všetkých na tejto pozícii, akým spôsobom sa im
  // počíta mzda ("hodinovy", default zachováva PRESNE dnešné správanie).
  // Zamestnanec ho smie prepísať (employees.override_pay_mode).
  payMode: payModeEnum("pay_mode").notNull().default("hodinovy"),

  // Režim odchodu — default pre všetkých na tejto pozícii, kto si reálne pípa
  // odchod ("pipa", default zachováva PRESNE dnešné správanie) vs. komu sa
  // odchod AUTO-pípne na konci plánovanej zmeny, ak nepípne sám ("nepipa").
  // Zamestnanec ho smie prepísať (employees.override_departure_mode). Rovnaký
  // vzor ako break_tracking_mode vyššie — TOTO ale rieši len ODCHOD, nie
  // prestávky; prestávkový dôkaz (odišiel na prestávku, nevrátil sa) platí
  // pre VŠETKÝCH nezávisle od tohto nastavenia (viď lib/punch/auto-close.ts).
  departureMode: departureModeEnum("departure_mode").notNull().default("pipa"),

  // Vedúci smeny — či generátor má na každý deň tejto pozície priradiť
  // PRÁVE JEDNÉHO vedúceho spomedzi už priradených ľudí (viď
  // shiftLeaderAssignments nižšie). Na úrovni celej pozície (nie per
  // shift_template) — ak klient bude neskôr chcieť napr. "len nočná zmena",
  // presunie sa to na coverage_requirements (vedomé rozhodnutie, nie dopredu).
  requiresShiftLeader: boolean("requires_shift_leader").notNull().default(false),
});

// ---------------------------------------------------------------------------
// HISTÓRIA POZÍCIÍ — EXCLUDE constraint (žiadne prekrývajúce sa obdobia) je
// pridaná v raw SQL migrácii (lib/db/migrations/0001_raw.sql), Drizzle ju
// nevie vygenerovať.
// ---------------------------------------------------------------------------
export const employeePositionHistory = pgTable("employee_position_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  positionId: uuid("position_id")
    .notNull()
    .references(() => positions.id),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
});

// ---------------------------------------------------------------------------
// HISTÓRIA SADZIEB — rovnako, EXCLUDE constraint v raw SQL migrácii.
// ---------------------------------------------------------------------------
export const employeeRateHistory = pgTable("employee_rate_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  workplaceId: uuid("workplace_id").references(() => workplaces.id),
  hourlyRate: numeric("hourly_rate", { precision: 8, scale: 4 }).notNull(),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
});

// ---------------------------------------------------------------------------
// HISTÓRIA FIXNÉHO PLATU — nová tabuľka, ZÁMERNE nie rozšírenie
// employee_rate_history (ten je overený/citlivý, nemení sa tvar). Rovnaký
// vzor ako história sadzieb (EXCLUDE constraint v raw SQL migrácii), ale BEZ
// workplace_id — fixný plat je vlastnosť ČLOVEKA, nie prevádzky (na rozdiel
// od hodinovej sadzby, ktorá sa môže líšiť podľa prevádzky). Viď
// lib/payroll/calculate.ts::getSalaryAt.
// ---------------------------------------------------------------------------
export const employeeSalaryHistory = pgTable("employee_salary_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  fixAmount: numeric("fix_amount", { precision: 10, scale: 2 }).notNull(),
  variableAmount: numeric("variable_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
});

// ============================================================================
// 4. PRACOVNÉ PRAVIDLÁ ZAMESTNANCA ← JADRO SYSTÉMU
// ============================================================================

export const shiftTemplates = pgTable(
  "shift_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    crossesMidnight: boolean("crosses_midnight").notNull().default(false),
    breakMinutes: integer("break_minutes").notNull().default(30),
    // Pípanie prestávok, krok 1 — `presny_cas` používa break_start_time/
    // break_end_time namiesto break_minutes (ktoré pri tomto režime nesie už
    // len posledný known-good odvodený počet, viď lib/shared/break-config.ts).
    breakMode: breakConfigModeEnum("break_mode").notNull().default("minuty"),
    breakStartTime: time("break_start_time"),
    breakEndTime: time("break_end_time"),
    color: text("color"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique().on(t.workplaceId, t.code)],
);

export const employeeShiftTemplates = pgTable(
  "employee_shift_templates",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    shiftTemplateId: uuid("shift_template_id")
      .notNull()
      .references(() => shiftTemplates.id, { onDelete: "cascade" }),

    overrideStartTime: time("override_start_time"),
    overrideEndTime: time("override_end_time"),
    overrideBreakMin: integer("override_break_min"),

    isPreferred: boolean("is_preferred").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.shiftTemplateId] })],
);

// ---------------------------------------------------------------------------
// PRAVIDLÁ DOSTUPNOSTI — najdôležitejšia tabuľka celého systému.
// Každé pravidlo má is_hard flag (generátor ho nikdy neporuší, ak true).
// ---------------------------------------------------------------------------
export const availabilityRuleTypeEnum = pgEnum("availability_rule_type", [
  "allowed_weekdays",
  "blocked_weekdays",
  "block_length",
  "max_consecutive_days",
  "min_rest_days",
  "week_parity",
  "date_range_available",
  "date_range_blocked",
  "max_hours_per_week",
  "max_hours_per_month",
  "min_hours_per_month",
  "preferred_shift",
]);

export const employeeAvailabilityRules = pgTable(
  "employee_availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id").references(() => workplaces.id),

    ruleType: availabilityRuleTypeEnum("rule_type").notNull(),

    params: jsonb("params").notNull(),

    // KĽÚČOVÉ: smie sa toto pravidlo porušiť?
    isHard: boolean("is_hard").notNull().default(true),

    priority: integer("priority").notNull().default(100),
    note: text("note"),

    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [index().on(t.employeeId, t.isActive)],
);

// ---------------------------------------------------------------------------
// PÁROVANIE ZAMESTNANCOV — "pracuje preferovane s [X]". Nezávislé od pozície
// aj prevádzky (recepčná + wellness zamestnankyňa sa dajú spárovať rovnako
// ako dvaja na tej istej pozícii) — preto ŽIADEN workplace_id/position_id,
// len dvojica employee_id.
//
// Vzťah je OBOJSMERNÝ, ale ukladá sa ako JEDEN riadok, nie dva (A→B aj B→A
// by znamenalo dve miesta, ktoré sa dajú rozísť — napr. zmazať jeden smer a
// nechať druhý). `employee_a_id < employee_b_id` (CHECK, UUID textová
// aritmetika) vynucuje kanonické poradie — appka pri zápise VŽDY zoradí
// dvojicu pred insertom (`lib/employees/pairings.ts`), takže (A,B) aj (B,A)
// zadané v UI skončia v tom istom riadku. Čítanie preto vždy hľadá zhodu v
// OBOCH stĺpcoch (`employee_a_id = X OR employee_b_id = X`), nikdy len v
// jednom.
// ---------------------------------------------------------------------------
export const employeePairings = pgTable(
  "employee_pairings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeAId: uuid("employee_a_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    employeeBId: uuid("employee_b_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    // KĽÚČOVÉ: tvrdý pár MUSÍ mať zmenu v ten istý deň vždy (radšej diera pre
    // oboch), mäkký len zvyšuje skóre, keď to vyjde (Blok 14b/c).
    isHard: boolean("is_hard").notNull().default(false),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [
    check("employee_pairings_order_check", sql`${t.employeeAId} < ${t.employeeBId}`),
    unique().on(t.employeeAId, t.employeeBId),
    index().on(t.employeeAId, t.isActive),
    index().on(t.employeeBId, t.isActive),
  ],
);

// ---------------------------------------------------------------------------
// PRAVIDLÁ PREVÁDZKY — minimálne pokrytie, §ZP limity. Konfigurovateľné,
// pretože klient ich ešte nepozná (viď OTAZKY.md).
// ---------------------------------------------------------------------------
export const coverageRequirements = pgTable("coverage_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  workplaceId: uuid("workplace_id")
    .notNull()
    .references(() => workplaces.id, { onDelete: "cascade" }),
  positionId: uuid("position_id").references(() => positions.id),
  // Blok 9d-4 (OTAZKY.md #42/#59) — KTORÚ zmenu má toto pokrytie obsadiť.
  // NULLABLE zámerne: existujúce riadky (a napr. Office, ktoré dnes nemá ANI
  // JEDEN shift_template) nemajú platnú hodnotu na backfill — CLAUDE.md
  // princíp 4, nezadrátovať odhad. Bez väzby generátor toto pravidlo
  // ignoruje (lib/scheduler/db-loader.ts), UI to viditeľne označí.
  shiftTemplateId: uuid("shift_template_id").references(() => shiftTemplates.id, { onDelete: "set null" }),

  minPeople: integer("min_people").notNull().default(1),
  maxPeople: integer("max_people"),

  weekdays: smallint("weekdays")
    .array()
    .default(sql`'{1,2,3,4,5,6,7}'`),
  appliesHolidays: boolean("applies_holidays").notNull().default(true),

  isHard: boolean("is_hard").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
});

export const legalRules = pgTable(
  "legal_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    params: jsonb("params").notNull(),
    isHard: boolean("is_hard").notNull().default(true),
    lawReference: text("law_reference"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique().on(t.orgId, t.code)],
);

// ============================================================================
// 5. ROZVRH (plán)
// ============================================================================

export const scheduleStatusEnum = pgEnum("schedule_status", [
  "draft",
  "published",
]);

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: scheduleStatusEnum("status").notNull().default("draft"),

    generatedAt: timestamp("generated_at", { withTimezone: true }),
    generatedBy: uuid("generated_by").references(() => users.id),
    generationRunId: uuid("generation_run_id"),
  },
  (t) => [
    unique().on(t.workplaceId, t.year, t.month),
    check("schedules_month_check", sql`${t.month} BETWEEN 1 AND 12`),
  ],
);

export const shiftSourceEnum = pgEnum("shift_source", [
  "generated",
  "manual",
  "regenerated",
]);

export const scheduledShifts = pgTable(
  "scheduled_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id),
    date: date("date").notNull(),

    shiftTemplateId: uuid("shift_template_id").references(
      () => shiftTemplates.id,
    ),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    crossesMidnight: boolean("crosses_midnight").notNull().default(false),

    source: shiftSourceEnum("source").notNull().default("generated"),
    locked: boolean("locked").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [
    unique().on(t.employeeId, t.workplaceId, t.date),
    index().on(t.workplaceId, t.date),
    index().on(t.employeeId, t.date),
  ],
);

/**
 * Zverejnenie rozvrhu, krok 1 — "zrkadlová" snímka `scheduled_shifts` v
 * momente kliknutia na "Zverejniť rozvrh". Zamestnanec ČÍTA VÝHRADNE túto
 * tabuľku (`moj-rozvrh/data.ts`), NIKDY `scheduled_shifts` priamo — tá je
 * live PRACOVNÝ NÁVRH manažéra, ktorý sa priebežne prepisuje (aj
 * pregenerovaním) a zamestnanec ho nesmie vidieť, kým nie je zverejnený.
 *
 * PREČO samostatná tabuľka, nie stĺpec/status na `scheduled_shifts`: keby
 * zamestnanec čítal `scheduled_shifts` s podmienkou "len keď je schedule
 * published", pri REGENERÁCII už zverejneného mesiaca by nevidel STARÝ
 * zverejnený obsah (ten prepíše `persistGenerateResult` na mieste), videl by
 * NIČ, kým manažér nezverejní nový návrh — presný opak toho, čo má vidieť.
 * Táto tabuľka je preto NEZÁVISLÁ kópia — pri "Zverejniť" sa celá prepíše
 * (zmaže + znova naplní z aktuálneho stavu `scheduled_shifts`), ale MEDZI
 * zverejneniami ju regenerácia draftu vôbec nevidí/nemení.
 */
export const publishedShifts = pgTable(
  "published_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id),
    date: date("date").notNull(),

    shiftTemplateId: uuid("shift_template_id").references(() => shiftTemplates.id),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    crossesMidnight: boolean("crosses_midnight").notNull().default(false),

    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedBy: uuid("published_by").references(() => users.id),
  },
  (t) => [
    unique().on(t.employeeId, t.workplaceId, t.date),
    index().on(t.workplaceId, t.date),
    index().on(t.employeeId, t.date),
  ],
);

/**
 * Vedúci smeny, krok 2 — rozhodnutie "kto vedie" pre (workplace, position,
 * date), jeden riadok NAJVIAC pre každú trojicu (`unique` nižšie). Vedúci je
 * VŽDY jeden z už priradených na `scheduled_shifts` tú istú prevádzku/deň —
 * táto tabuľka len OZNAČUJE, nikdy nemení, koľko ľudí je na smene (viď
 * `lib/scheduler/shift-leader.ts`, samostatný prechod PO celom generovaní).
 * SAMOSTATNÁ tabuľka namiesto stĺpca na `scheduled_shifts` — tá nemá
 * `positionId` (rieši sa cez `employee_position_history`) a "najviac jeden
 * vedúci na deň" sa dá DB-úrovňou zaručiť len `unique` na (workplace,
 * position, date), nie roztrúsenými booleanmi na N riadkoch.
 *
 * `employeeId = null` je VEDOMÉ rozhodnutie "žiadny vedúci" (len pri
 * `source = 'manual'`, viď krok 5) — odlíšiteľné od chýbajúceho riadku
 * (generátor sa tým dňom ešte nezaoberal / nikto oprávnený nepracoval,
 * viď `schedule_violations`, `rule_code = 'NO_SHIFT_LEADER'`).
 *
 * `source = 'generated'` riadky prepočíta KAŽDÁ regenerácia mesiaca (zmažú
 * sa a založia nanovo, presne vzor `scheduled_shifts`); `source = 'manual'`
 * (ručný prepis manažérom, krok 5) regenerácia NIKDY nezmení.
 */
export const shiftLeaderAssignments = pgTable(
  "shift_leader_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id),
    date: date("date").notNull(),

    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
    source: shiftSourceEnum("source").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.workplaceId, t.positionId, t.date)],
);

export const generationRuns = pgTable("generation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workplaceId: uuid("workplace_id")
    .notNull()
    .references(() => workplaces.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  triggeredBy: uuid("triggered_by").references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  shiftsCreated: integer("shifts_created").default(0),
  status: text("status"),
  inputSnapshot: jsonb("input_snapshot"),
});

// ---------------------------------------------------------------------------
// PORUŠENIA A DIERY — generátor nerobí násilie: nechá dieru a presne povie
// prečo (viď CLAUDE.md, princíp 6).
// ---------------------------------------------------------------------------
export const violationSeverityEnum = pgEnum("violation_severity", [
  "gap",
  "hard_violation",
  "soft_violation",
]);

export const scheduleViolations = pgTable(
  "schedule_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    generationRunId: uuid("generation_run_id").references(
      () => generationRuns.id,
      { onDelete: "cascade" },
    ),

    date: date("date").notNull(),
    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "cascade",
    }),
    positionId: uuid("position_id").references(() => positions.id),

    severity: violationSeverityEnum("severity").notNull(),
    ruleCode: text("rule_code").notNull(),
    ruleSource: text("rule_source"),

    message: text("message").notNull(),
    details: jsonb("details"),

    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index().on(t.scheduleId, t.resolved, t.date)],
);

// ============================================================================
// 6. ABSENCIE A ŽIADOSTI
// ============================================================================

export const absenceKindEnum = pgEnum("absence_kind", [
  "dovolenka",
  "pn",
  "ocr",
  "paragraf",
  "neplatene",
  "nahradne_volno",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const absenceRequests = pgTable(
  "absence_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id),

    kind: absenceKindEnum("kind").notNull(),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),

    isPartialDay: boolean("is_partial_day").notNull().default(false),
    hours: numeric("hours", { precision: 5, scale: 2 }),

    reason: text("reason"),
    status: requestStatusEnum("status").notNull().default("pending"),

    requestedBy: uuid("requested_by").references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (t) => [
    index().on(t.workplaceId, t.status, t.dateFrom),
    index().on(t.employeeId, t.dateFrom),
    check("absence_requests_date_check", sql`${t.dateTo} >= ${t.dateFrom}`),
    check(
      "absence_requests_rejection_note_check",
      sql`${t.status} <> 'rejected' OR ${t.decisionNote} IS NOT NULL`,
    ),
  ],
);

export const absenceAttachments = pgTable("absence_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => absenceRequests.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// ABSENCIE = materializovaný stav (žiadosť → dni). Generátor číta TOTO,
// nie žiadosti. is_confirmed rozlišuje schválené od visiacich (blokujú tiež).
// ---------------------------------------------------------------------------
export const absences = pgTable(
  "absences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id),
    requestId: uuid("request_id").references(() => absenceRequests.id, {
      onDelete: "cascade",
    }),

    date: date("date").notNull(),
    kind: absenceKindEnum("kind").notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }),

    isConfirmed: boolean("is_confirmed").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.employeeId, t.date), index().on(t.workplaceId, t.date)],
);

export const vacationBalances = pgTable(
  "vacation_balances",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    entitledDays: numeric("entitled_days", {
      precision: 5,
      scale: 2,
    }).notNull(),
    carriedOverDays: numeric("carried_over_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    takenDays: numeric("taken_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.year] })],
);

// ============================================================================
// 7. PÍPANIE — RAZÍTKA
//
// Kľúčový princíp: punch_events sú IMMUTABLE (append-only). Trigger v raw SQL
// migrácii (lib/db/migrations/0001_raw.sql) zakazuje UPDATE/DELETE.
// ============================================================================

export const terminals = pgTable("terminals", {
  id: uuid("id").primaryKey().defaultRandom(),
  workplaceId: uuid("workplace_id")
    .notNull()
    .references(() => workplaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  deviceId: text("device_id").notNull().unique(),

  secretHash: text("secret_hash").notNull(),

  gpsLat: numeric("gps_lat", { precision: 10, scale: 7 }),
  gpsLng: numeric("gps_lng", { precision: 10, scale: 7 }),

  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  firmwareVersion: text("firmware_version"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const punchDirectionEnum = pgEnum("punch_direction", ["in", "out"]);
export const punchMethodEnum = pgEnum("punch_method", [
  "qr_terminal",
  "web",
  "manual",
  "auto_close",
]);
// Pípanie prestávok, krok 3 — ORTOGONÁLNE k `direction` (in/out), nie
// rozšírenie jeho hodnôt: "zmena" = doterajší príchod/odchod (default,
// zachováva presne dnešné správanie), "prestavka" = nová druhá dvojica
// razítok (odchod/príchod z prestávky). `determineDirection` (lib/punch/
// attendance.ts) prepína smer NEZÁVISLE pre každý kind v rámci toho istého
// dňa — dve súbežné "in/out" sekvencie, nie jedna zdieľaná.
export const punchKindEnum = pgEnum("punch_kind", ["zmena", "prestavka"]);

export const punchEvents = pgTable(
  "punch_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id),

    direction: punchDirectionEnum("direction").notNull(),
    method: punchMethodEnum("method").notNull(),
    kind: punchKindEnum("kind").notNull().default("zmena"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    isOfflineSync: boolean("is_offline_sync").notNull().default(false),

    terminalId: uuid("terminal_id").references(() => terminals.id),

    gpsLat: numeric("gps_lat", { precision: 10, scale: 7 }),
    gpsLng: numeric("gps_lng", { precision: 10, scale: 7 }),
    gpsAccuracyM: numeric("gps_accuracy_m", { precision: 8, scale: 2 }),
    gpsDistanceM: numeric("gps_distance_m", { precision: 10, scale: 2 }),
    gpsSuspicious: boolean("gps_suspicious").notNull().default(false),

    qrTokenJti: text("qr_token_jti").unique(),

    ip: inet("ip"),
    userAgent: text("user_agent"),

    correctsEventId: bigint("corrects_event_id", {
      mode: "number",
    }).references((): AnyPgColumn => punchEvents.id),
    correctionReason: text("correction_reason"),
    // Granulárna oprava jednotlivého pípnutia — "zmazanie" (append-only, CLAUDE.md
    // princíp 3): táto udalosť VÔBEC nepredstavuje reálne pípnutie, len anuluje
    // pôvodnú (`corrects_event_id`) BEZ náhrady. Rozdiel od bežnej opravy (mení
    // čas/typ a NAHRÁDZA pôvodnú) — viď lib/punch/attendance.ts#eventsForLocalDate,
    // ktoré túto udalosť aj jej `corrects_event_id` cieľ vždy vynechá z výpočtu.
    isVoid: boolean("is_void").notNull().default(false),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index().on(t.employeeId, t.occurredAt.desc()),
    index().on(t.workplaceId, t.occurredAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// QR TOKENY — anti-replay (jti sa dá minúť len raz).
// ---------------------------------------------------------------------------
export const qrTokens = pgTable(
  "qr_tokens",
  {
    jti: text("jti").primaryKey(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByTerminal: uuid("used_by_terminal").references(() => terminals.id),
  },
  (t) => [
    index()
      .on(t.expiresAt)
      .where(sql`${t.usedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// DENNÝ ZÁZNAM — odvodený z razítok, prepočítava sa triggerom/appkou pri
// každom novom razítku.
// ---------------------------------------------------------------------------
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "planned",
  "working",
  "done",
  "absent",
  "missing",
  "auto_closed",
]);

export const attendanceDays = pgTable(
  "attendance_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workplaceId: uuid("workplace_id")
      .notNull()
      .references(() => workplaces.id),
    date: date("date").notNull(),

    scheduledShiftId: uuid("scheduled_shift_id").references(
      () => scheduledShifts.id,
      { onDelete: "set null" },
    ),
    plannedStart: time("planned_start"),
    plannedEnd: time("planned_end"),

    actualStart: timestamp("actual_start", { withTimezone: true }),
    actualEnd: timestamp("actual_end", { withTimezone: true }),

    breakMinutes: integer("break_minutes").notNull().default(0),

    workedHours: numeric("worked_hours", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    overtimeHours: numeric("overtime_hours", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    weekendHours: numeric("weekend_hours", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    holidayHours: numeric("holiday_hours", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    // Blok 12 — PREKRÝVA sa s weekend_hours/holiday_hours (§123 ZP), nie samostatná kategória.
    nightHours: numeric("night_hours", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),

    isLate: boolean("is_late").notNull().default(false),
    lateMinutes: integer("late_minutes").notNull().default(0),

    status: attendanceStatusEnum("status").notNull().default("planned"),

    isCorrected: boolean("is_corrected").notNull().default(false),
    correctedBy: uuid("corrected_by").references(() => users.id),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    correctionNote: text("correction_note"),

    isLocked: boolean("is_locked").notNull().default(false),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.employeeId, t.date),
    index().on(t.workplaceId, t.date),
    index().on(t.employeeId, t.date.desc()),
  ],
);

export const punchCorrectionRequests = pgTable("punch_correction_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  attendanceDayId: uuid("attendance_day_id")
    .notNull()
    .references(() => attendanceDays.id, { onDelete: "cascade" }),

  requestedStart: timestamp("requested_start", { withTimezone: true }),
  requestedEnd: timestamp("requested_end", { withTimezone: true }),
  reason: text("reason").notNull(),

  status: requestStatusEnum("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * "Chýba mi pípnutie" — zamestnanec žiada PRIDANIE úplne chýbajúceho pípnutia
 * (terminál nešiel/appka spadla, žiadny punch_events záznam vôbec neexistuje),
 * nie OPRAVU existujúceho (na to je `punchCorrectionRequests`). Zámerne
 * SAMOSTATNÁ tabuľka, nie ďalšie nullable stĺpce na `punchCorrectionRequests`:
 * odkazuje priamo na `employeeId`+`workplaceId`+`date` (nie `attendanceDayId`),
 * lebo `attendance_days` riadok pre úplne vynechaný deň ešte NEMUSÍ existovať
 * (vzniká lenivo, až pri prvom pípnutí — `recomputeAttendanceDay`). Rovnaký
 * tok ako `punchCorrectionRequests` (zamestnanec žiada → manažér/owner
 * rozhodne), viď `app/(app)/moja-dochadzka/actions.ts` a `app/(app)/dnes/actions.ts`.
 */
export const missingPunchRequests = pgTable("missing_punch_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  workplaceId: uuid("workplace_id")
    .notNull()
    .references(() => workplaces.id),
  date: date("date").notNull(),

  direction: punchDirectionEnum("direction").notNull(),
  kind: punchKindEnum("kind").notNull().default("zmena"),
  requestedTime: timestamp("requested_time", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),

  status: requestStatusEnum("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ============================================================================
// 8. AUDIT LOG
// Zapisuje sa triggerom (raw SQL migrácia), nie z aplikácie.
// ============================================================================

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id"),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    action: text("action").notNull(),
    oldData: jsonb("old_data"),
    newData: jsonb("new_data"),
    changedBy: uuid("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: inet("ip"),
  },
  (t) => [
    index().on(t.tableName, t.recordId, t.changedAt.desc()),
    index().on(t.changedBy, t.changedAt.desc()),
    index().on(t.changedAt.desc()),
  ],
);

// ============================================================================
// 9. NOTIFIKÁCIE
// ============================================================================

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    payload: jsonb("payload"),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index().on(t.userId, t.readAt, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Blok 11 — preferencie kanálov PER typ notifikácie ("kind"). In-app je VŽDY
// zapnuté (žiadny riadok preň). Chýbajúci riadok pre daný (user, kind,
// channel) = kanál zapnutý (opt-out model) — viď migrácia 0019.
// ---------------------------------------------------------------------------
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.channel] })],
);
