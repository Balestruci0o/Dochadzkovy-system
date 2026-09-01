import { ABSENCE_KIND_CONFIG, type AbsenceKind } from "@/components/calendar/absence-kinds";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

export type AuditEntryInput = {
  tableName: string;
  action: AuditAction;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
};

export type DescribedAuditEntry = {
  /** Slovenský popis akcie, napr. "Schválenie žiadosti", "Oprava pípnutia". */
  actionLabel: string;
  /** ID zamestnanca/zamestnancov, ktorých sa riadok týka — na dorezolvovanie mena v data.ts (batch join, nie tu). */
  employeeIds: string[];
  /** Doplňujúci kontext odvoditeľný PRIAMO z old/new dát, bez ďalšieho DB dopytu (dátum zmeny, obdobie dovolenky, suma sadzby...). */
  extra: string | null;
  /** Mzdové sadzby a trvalé zmazanie (#89 bypass) — UI ich môže zvýrazniť/oddeliť. */
  sensitive: boolean;
};

/** Nazvy tabuliek presne ako TG_TABLE_NAME (snake_case, nie Drizzle názvy premenných). */
export const TABLE_LABELS: Record<string, string> = {
  employees: "Zamestnanec",
  scheduled_shifts: "Zmena",
  absence_requests: "Žiadosť o neprítomnosť",
  employee_rate_history: "Mzdová sadzba",
  employee_salary_history: "Fixný plat",
  employee_availability_rules: "Pravidlo dostupnosti",
  employee_pairings: "Párovanie zamestnancov",
  attendance_days: "Deň dochádzky",
  punch_events: "Pípnutie",
  users: "Konto",
};

export function tableLabel(tableName: string): string {
  return TABLE_LABELS[tableName] ?? tableName;
}

function fullName(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const first = data.first_name;
  const last = data.last_name;
  if (typeof first !== "string" && typeof last !== "string") return null;
  return [first, last].filter((s): s is string => typeof s === "string" && s.length > 0).join(" ") || null;
}

function str(data: Record<string, unknown> | null, key: string): string | null {
  const v = data?.[key];
  return typeof v === "string" ? v : null;
}

function bool(data: Record<string, unknown> | null, key: string): boolean | null {
  const v = data?.[key];
  return typeof v === "boolean" ? v : null;
}

function absenceLabel(kind: string | null): string {
  if (kind && kind in ABSENCE_KIND_CONFIG) return ABSENCE_KIND_CONFIG[kind as AbsenceKind].label;
  return kind ?? "neprítomnosť";
}

/**
 * Audit log — čistá funkcia (žiadny DB dopyt, žiadne joiny): premení surový
 * `table_name`/`action`/`old_data`/`new_data` na slovenský popis akcie a
 * čo sa dá vyčítať priamo z JSON payloadu. Meno zamestnanca pre `employeeIds`
 * mimo tabuľky `employees` (kde je vždy priamo v riadku) dorieši `data.ts`
 * dávkovým joinom — nemá zmysel robiť dopyt PER RIADOK v zozname stoviek/tisícov.
 */
export function describeAuditEntry({ tableName, action, oldData, newData }: AuditEntryInput): DescribedAuditEntry {
  const data = newData ?? oldData;

  switch (tableName) {
    case "employees": {
      const label = action === "INSERT" ? "Založenie zamestnanca" : action === "DELETE" ? "Trvalé zmazanie zamestnanca" : "Úprava údajov zamestnanca";
      const id = str(data, "id");
      return { actionLabel: label, employeeIds: id ? [id] : [], extra: fullName(data), sensitive: action === "DELETE" };
    }

    case "employee_rate_history": {
      const label = action === "INSERT" ? "Nastavenie mzdovej sadzby" : action === "DELETE" ? "Zmazanie záznamu sadzby" : "Úprava platnosti sadzby";
      const rate = str(data, "hourly_rate");
      const validFrom = str(data, "valid_from");
      const validTo = str(data, "valid_to");
      const extra = rate ? `${rate} €/h, od ${validFrom ?? "?"}${validTo ? ` do ${validTo}` : ""}` : null;
      const employeeId = str(data, "employee_id");
      return { actionLabel: label, employeeIds: employeeId ? [employeeId] : [], extra, sensitive: true };
    }

    case "employee_salary_history": {
      const label = action === "INSERT" ? "Nastavenie fixného platu" : action === "DELETE" ? "Zmazanie záznamu fixného platu" : "Úprava platnosti fixného platu";
      const fix = str(data, "fix_amount");
      const variable = str(data, "variable_amount");
      const validFrom = str(data, "valid_from");
      const validTo = str(data, "valid_to");
      const extra = fix ? `fix ${fix} € + variabilná ${variable ?? "0"} €, od ${validFrom ?? "?"}${validTo ? ` do ${validTo}` : ""}` : null;
      const employeeId = str(data, "employee_id");
      return { actionLabel: label, employeeIds: employeeId ? [employeeId] : [], extra, sensitive: true };
    }

    case "employee_availability_rules": {
      const label = action === "INSERT" ? "Pridanie pravidla dostupnosti" : action === "DELETE" ? "Zmazanie pravidla dostupnosti" : "Úprava pravidla dostupnosti";
      const employeeId = str(data, "employee_id");
      return { actionLabel: label, employeeIds: employeeId ? [employeeId] : [], extra: null, sensitive: false };
    }

    case "employee_pairings": {
      const label = action === "INSERT" ? "Pridanie párovania zamestnancov" : action === "DELETE" ? "Zrušenie párovania zamestnancov" : "Úprava párovania zamestnancov";
      const a = str(data, "employee_a_id");
      const b = str(data, "employee_b_id");
      return { actionLabel: label, employeeIds: [a, b].filter((x): x is string => x !== null), extra: null, sensitive: false };
    }

    case "absence_requests": {
      const kind = absenceLabel(str(data, "kind"));
      const employeeId = str(data, "employee_id");
      const dateFrom = str(data, "date_from");
      const dateTo = str(data, "date_to");
      const extra = dateFrom ? `${kind}, ${dateFrom}${dateTo && dateTo !== dateFrom ? ` – ${dateTo}` : ""}` : kind;

      let label: string;
      if (action === "INSERT") {
        label = "Nová žiadosť o neprítomnosť";
      } else if (action === "DELETE") {
        label = "Zmazanie žiadosti o neprítomnosť";
      } else {
        const oldStatus = str(oldData, "status");
        const newStatus = str(newData, "status");
        if (oldStatus === "pending" && newStatus === "approved") label = "Schválenie žiadosti";
        else if (oldStatus === "pending" && newStatus === "rejected") label = "Zamietnutie žiadosti";
        else if (newStatus === "cancelled") label = "Zrušenie žiadosti";
        else label = "Úprava žiadosti o neprítomnosť";
      }
      return { actionLabel: label, employeeIds: employeeId ? [employeeId] : [], extra, sensitive: false };
    }

    case "scheduled_shifts": {
      const employeeId = str(data, "employee_id");
      const date = str(data, "date");
      const start = str(data, "start_time");
      const end = str(data, "end_time");
      const source = str(data, "source");
      const extra = date ? `${date}${start && end ? `, ${start.slice(0, 5)}–${end.slice(0, 5)}` : ""}` : null;

      let label: string;
      if (action === "INSERT") label = source === "manual" ? "Manuálne priradenie zmeny" : "Vygenerovanie zmeny (generátor)";
      else if (action === "DELETE") label = "Zmazanie zmeny";
      else label = "Úprava zmeny";
      return { actionLabel: label, employeeIds: employeeId ? [employeeId] : [], extra, sensitive: false };
    }

    case "attendance_days": {
      const employeeId = str(data, "employee_id");
      const date = str(data, "date");
      const status = str(data, "status");
      const label = action === "DELETE" ? "Zmazanie dňa dochádzky" : "Prepočet dochádzky";
      return { actionLabel: label, employeeIds: employeeId ? [employeeId] : [], extra: date ? `${date}${status ? ` (${status})` : ""}` : null, sensitive: false };
    }

    case "punch_events": {
      const employeeId = str(data, "employee_id");
      const kind = str(data, "kind");
      const direction = str(data, "direction");
      const method = str(data, "method");
      const correctsId = data?.corrects_event_id;
      const isVoid = bool(data, "is_void") ?? false;
      const kindLabel = kind === "prestavka" ? "prestávka" : "zmena";
      const dirLabel = direction === "in" ? "príchod" : "odchod";

      let label: string;
      if (action === "DELETE") {
        label = "Trvalé zmazanie pípnutia";
      } else if (isVoid) {
        label = "Zrušenie pípnutia";
      } else if (correctsId != null) {
        label = "Oprava pípnutia";
      } else if (method === "auto_close") {
        label = "Automatické uzavretie (prestávka bez návratu)";
      } else {
        label = `Pípnutie — ${dirLabel} (${kindLabel})`;
      }
      return { actionLabel: label, employeeIds: employeeId ? [employeeId] : [], extra: null, sensitive: action === "DELETE" };
    }

    case "users": {
      // Jediný audit trigger na `users` (migrácia 0044) fire-uje LEN na
      // prechod deleted_at NULL → not NULL (Nastavenia → Kontá, zmazanie
      // prihlasovacieho konta) — iné UPDATE (napr. last_login_at pri
      // prihlásení) sa sem nikdy nedostanú, takže label je vždy tento.
      return { actionLabel: "Zmazanie prihlasovacieho konta", employeeIds: [], extra: str(data, "full_name"), sensitive: true };
    }

    default:
      return { actionLabel: `${action} — ${tableName}`, employeeIds: [], extra: null, sensitive: false };
  }
}
