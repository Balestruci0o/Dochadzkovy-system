import { describe, expect, it } from "vitest";
import { describeAuditEntry } from "./describe";

describe("describeAuditEntry — absence_requests", () => {
  it("INSERT → nová žiadosť", () => {
    const r = describeAuditEntry({ tableName: "absence_requests", action: "INSERT", oldData: null, newData: { employee_id: "e1", kind: "dovolenka", date_from: "2026-08-10", date_to: "2026-08-12", status: "pending" } });
    expect(r.actionLabel).toBe("Nová žiadosť o neprítomnosť");
    expect(r.employeeIds).toEqual(["e1"]);
  });

  it("UPDATE pending → approved = SCHVÁLENIE žiadosti", () => {
    const r = describeAuditEntry({
      tableName: "absence_requests",
      action: "UPDATE",
      oldData: { employee_id: "e1", kind: "dovolenka", date_from: "2026-08-10", date_to: "2026-08-12", status: "pending" },
      newData: { employee_id: "e1", kind: "dovolenka", date_from: "2026-08-10", date_to: "2026-08-12", status: "approved" },
    });
    expect(r.actionLabel).toBe("Schválenie žiadosti");
  });

  it("UPDATE pending → rejected = ZAMIETNUTIE žiadosti", () => {
    const r = describeAuditEntry({
      tableName: "absence_requests",
      action: "UPDATE",
      oldData: { status: "pending" },
      newData: { status: "rejected" },
    });
    expect(r.actionLabel).toBe("Zamietnutie žiadosti");
  });

  it("UPDATE bez zmeny statusu (napr. posun termínu) = generická úprava, nie schválenie/zamietnutie", () => {
    const r = describeAuditEntry({
      tableName: "absence_requests",
      action: "UPDATE",
      oldData: { status: "pending", date_from: "2026-08-10" },
      newData: { status: "pending", date_from: "2026-08-15" },
    });
    expect(r.actionLabel).toBe("Úprava žiadosti o neprítomnosť");
  });

  it("DELETE → zmazanie žiadosti", () => {
    const r = describeAuditEntry({ tableName: "absence_requests", action: "DELETE", oldData: { employee_id: "e1", kind: "pn" }, newData: null });
    expect(r.actionLabel).toBe("Zmazanie žiadosti o neprítomnosť");
  });
});

describe("describeAuditEntry — punch_events (oprava pípnutia)", () => {
  it("INSERT s corrects_event_id = OPRAVA pípnutia", () => {
    const r = describeAuditEntry({
      tableName: "punch_events",
      action: "INSERT",
      oldData: null,
      newData: { employee_id: "e1", kind: "zmena", direction: "in", corrects_event_id: 42, is_void: false },
    });
    expect(r.actionLabel).toBe("Oprava pípnutia");
  });

  it("INSERT normálne pípnutie (bez opravy) = Pípnutie — smer/typ", () => {
    const r = describeAuditEntry({
      tableName: "punch_events",
      action: "INSERT",
      oldData: null,
      newData: { employee_id: "e1", kind: "zmena", direction: "out", corrects_event_id: null, is_void: false },
    });
    expect(r.actionLabel).toBe("Pípnutie — odchod (zmena)");
  });

  it("DELETE = trvalé zmazanie pípnutia, OZNAČENÉ ako citlivé (#89 bypass)", () => {
    const r = describeAuditEntry({ tableName: "punch_events", action: "DELETE", oldData: { employee_id: "e1", kind: "zmena", direction: "in" }, newData: null });
    expect(r.actionLabel).toBe("Trvalé zmazanie pípnutia");
    expect(r.sensitive).toBe(true);
  });

  it("auto_close = automatické uzavretie", () => {
    const r = describeAuditEntry({
      tableName: "punch_events",
      action: "INSERT",
      oldData: null,
      newData: { employee_id: "e1", kind: "zmena", direction: "out", method: "auto_close", corrects_event_id: null, is_void: false },
    });
    expect(r.actionLabel).toBe("Automatické uzavretie (prestávka bez návratu)");
  });
});

describe("describeAuditEntry — scheduled_shifts (manuálne priradenie)", () => {
  it("INSERT source=manual → manuálne priradenie zmeny", () => {
    const r = describeAuditEntry({
      tableName: "scheduled_shifts",
      action: "INSERT",
      oldData: null,
      newData: { employee_id: "e1", date: "2026-08-15", start_time: "07:00:00", end_time: "15:00:00", source: "manual" },
    });
    expect(r.actionLabel).toBe("Manuálne priradenie zmeny");
    expect(r.extra).toBe("2026-08-15, 07:00–15:00");
  });

  it("INSERT source=generated → vygenerovanie zmeny (generátor)", () => {
    const r = describeAuditEntry({
      tableName: "scheduled_shifts",
      action: "INSERT",
      oldData: null,
      newData: { employee_id: "e1", date: "2026-08-15", source: "generated" },
    });
    expect(r.actionLabel).toBe("Vygenerovanie zmeny (generátor)");
  });

  it("DELETE → zmazanie zmeny", () => {
    const r = describeAuditEntry({ tableName: "scheduled_shifts", action: "DELETE", oldData: { employee_id: "e1", date: "2026-08-15" }, newData: null });
    expect(r.actionLabel).toBe("Zmazanie zmeny");
  });
});

describe("describeAuditEntry — employees a mzdové sadzby (citlivé)", () => {
  it("employees DELETE (#89 bypass) → trvalé zmazanie, citlivé, meno priamo z riadku", () => {
    const r = describeAuditEntry({
      tableName: "employees",
      action: "DELETE",
      oldData: { id: "e1", first_name: "Jana", last_name: "Nováková" },
      newData: null,
    });
    expect(r.actionLabel).toBe("Trvalé zmazanie zamestnanca");
    expect(r.sensitive).toBe(true);
    expect(r.extra).toBe("Jana Nováková");
    expect(r.employeeIds).toEqual(["e1"]);
  });

  it("employee_rate_history je VŽDY citlivé (mzdová sadzba), bez ohľadu na akciu", () => {
    const insert = describeAuditEntry({ tableName: "employee_rate_history", action: "INSERT", oldData: null, newData: { employee_id: "e1", hourly_rate: "7.5000", valid_from: "2026-08-01" } });
    expect(insert.sensitive).toBe(true);
    expect(insert.actionLabel).toBe("Nastavenie mzdovej sadzby");
    expect(insert.extra).toBe("7.5000 €/h, od 2026-08-01");
  });

  it("employee_salary_history je VŽDY citlivé (fixný plat), bez ohľadu na akciu", () => {
    const insert = describeAuditEntry({ tableName: "employee_salary_history", action: "INSERT", oldData: null, newData: { employee_id: "e1", fix_amount: "1000.00", variable_amount: "150.00", valid_from: "2026-08-01" } });
    expect(insert.sensitive).toBe(true);
    expect(insert.actionLabel).toBe("Nastavenie fixného platu");
    expect(insert.extra).toBe("fix 1000.00 € + variabilná 150.00 €, od 2026-08-01");
  });
});

describe("describeAuditEntry — neznáma tabuľka (fallback, nikdy nepadne)", () => {
  it("neaudítovaná/budúca tabuľka dostane bezpečný fallback popis", () => {
    const r = describeAuditEntry({ tableName: "niečo_nové", action: "UPDATE", oldData: {}, newData: {} });
    expect(r.actionLabel).toBe("UPDATE — niečo_nové");
    expect(r.employeeIds).toEqual([]);
  });
});
