import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako publish-flow.test.ts)
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { auditLog, employees, organizations, users } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import type { CurrentUser } from "@/lib/auth/session";
import { DEFAULT_MANAGER_PERMISSIONS } from "@/lib/auth/manager-permissions";
import { getAuditLogPage, PAGE_SIZE } from "./data";

let orgId: string;
let ownerUser: CurrentUser;
let employeeId: string;
let scheduledShiftRecordId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `audit-data test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const ownerAuthUserId = crypto.randomUUID();
  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: ownerAuthUserId, email: `owner-${crypto.randomUUID()}@audit-data-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerUser = { id: owner.id, authUserId: ownerAuthUserId, orgId, role: "owner", fullName: owner.fullName, email: owner.email ?? "", permissions: { ...DEFAULT_MANAGER_PERMISSIONS } };

  const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Jana", lastName: "Testová", hiredOn: "2024-01-01" }).returning();
  employeeId = employee.id;

  // Reálna akcia cez skutočný trigger (nie priamy INSERT do audit_log) — over
  // end-to-end vrátane org_id rezolúcie (0043) a changed_by = owner.
  await withUserContext(ownerUser.id, (tx) => tx.update(employees).set({ notes: "test poznámka" }).where(eq(employees.id, employeeId)));

  // Priamy INSERT s changed_by = NULL — simuluje cron/generátor (service role
  // zápis bez app.user_id). audit_log.org_id NEMÁ FK (schema.ts) — deleteOrgCascade
  // v afterAll ho preto NIKDY nezmaže (správne, audit má prežiť aj zmazanie org),
  // takže riadky z OPAKOVANÝCH behov tohto testu sa v DB hromadia navždy. Jediný
  // spoľahlivý spôsob, ako nájsť PRESNE TENTO riadok neskôr, je jeho vlastné
  // record_id (crypto.randomUUID(), naozaj unikátne) — nie dátum, nie "posledný".
  scheduledShiftRecordId = crypto.randomUUID();
  await adminDb.insert(auditLog).values({
    orgId,
    tableName: "scheduled_shifts",
    recordId: scheduledShiftRecordId,
    action: "INSERT",
    newData: { employee_id: employeeId, date: "2026-09-01", start_time: "07:00:00", end_time: "15:00:00", source: "generated" },
    changedBy: null,
  });

  // Dosť riadkov na overenie stránkovania (PAGE_SIZE + 5, zámerne za sebou, aby mali odlišný changed_at).
  for (let i = 0; i < PAGE_SIZE + 5; i++) {
    await adminDb.insert(auditLog).values({
      orgId,
      tableName: "absence_requests",
      recordId: crypto.randomUUID(),
      action: "INSERT",
      newData: { employee_id: employeeId, kind: "dovolenka", date_from: "2026-10-01", date_to: "2026-10-01", status: "pending" },
      changedBy: ownerUser.id,
    });
  }
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("getAuditLogPage", () => {
  it("reálna zmena cez skutočný trigger sa objaví so správnym popisom, menom zamestnanca a menom pôvodcu", async () => {
    // tableName='employees' samo osebe by chytilo AJ iné riadky TEJTO ISTEJ org
    // zo súbežne bežiacich testov. changedBy=ownerUser.id (čerstvo vygenerovaný,
    // unikátny) scopuje deterministicky len na TENTO test.
    const page = await getAuditLogPage(ownerUser, { tableName: "employees", changedBy: ownerUser.id });
    const row = page.rows.find((r) => r.subjectLabel === "Jana Testová");
    expect(row).toBeDefined();
    expect(row?.actionLabel).toBe("Úprava údajov zamestnanca");
    expect(row?.changedByLabel).toBe("Test Majiteľ");
  });

  it("changed_by = NULL (cron/generátor) sa zobrazí ako 'Systém', nie chyba/prázdno", async () => {
    const page = await getAuditLogPage(ownerUser, { recordId: scheduledShiftRecordId });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].changedByLabel).toBe("Systém (bez prihláseného používateľa — cron, generátor)");
    expect(page.rows[0].subjectLabel).toBe("Jana Testová");
  });

  it("filter podľa tabuľky funguje — vráti LEN zvolenú oblasť", async () => {
    const page = await getAuditLogPage(ownerUser, { tableName: "absence_requests" });
    expect(page.rows.every((r) => r.tableName === "absence_requests")).toBe(true);
    expect(page.rows.length).toBeGreaterThan(0);
  });

  it("filter podľa používateľa funguje", async () => {
    const page = await getAuditLogPage(ownerUser, { changedBy: ownerUser.id, tableName: "scheduled_shifts" });
    expect(page.rows).toHaveLength(0); // ten scheduled_shifts riadok má changed_by=null, nie owner
  });

  it("stránkovanie — presne PAGE_SIZE riadkov na stránku, najnovšie hore, totalCount sedí", async () => {
    // Samotný tableName filter by chytil AJ absence_requests iných testov v TEJTO
    // ISTEJ org bežiacich súbežne — pridaný changedBy scopuje presne na TENTO test.
    const page1 = await getAuditLogPage(ownerUser, { tableName: "absence_requests", changedBy: ownerUser.id });
    expect(page1.rows).toHaveLength(PAGE_SIZE);
    expect(page1.totalCount).toBe(PAGE_SIZE + 5);

    const page2 = await getAuditLogPage(ownerUser, { tableName: "absence_requests", changedBy: ownerUser.id, page: 2 });
    expect(page2.rows).toHaveLength(5);

    // najnovšie hore: posledný vložený riadok (najvyššie id/najneskorší changed_at) je prvý v page1
    expect(page1.rows[0].changedAt.getTime()).toBeGreaterThanOrEqual(page1.rows[1].changedAt.getTime());
  });

  it("filterOptions.tables obsahuje všetkých 10 auditovaných tabuliek", async () => {
    const page = await getAuditLogPage(ownerUser, {});
    expect(page.filterOptions.tables.length).toBe(10);
  });

  it("owner NEVIDÍ audit_log riadky INEJ organizácie, aj keď filtre nič nescopujú (RLS audit_log_select_owner, migrácia 0045)", async () => {
    const [otherOrg] = await adminDb.insert(organizations).values({ name: `audit-data test — iná org ${crypto.randomUUID()}` }).returning();
    const otherAuthUserId = crypto.randomUUID();
    const [otherOwner] = await adminDb
      .insert(users)
      .values({ orgId: otherOrg.id, authUserId: otherAuthUserId, email: `owner-${crypto.randomUUID()}@audit-data-test.local`, role: "owner", fullName: "Iný Majiteľ" })
      .returning();
    const otherRecordId = crypto.randomUUID();
    await adminDb.insert(auditLog).values({
      orgId: otherOrg.id,
      tableName: "employees",
      recordId: otherRecordId,
      action: "INSERT",
      newData: { first_name: "Cudzí", last_name: "Zamestnanec" },
      changedBy: otherOwner.id,
    });

    try {
      // Bez filtrov okrem recordId — keby RLS/app filter na org_id chýbal, toto by riadok našlo.
      const page = await getAuditLogPage(ownerUser, { recordId: otherRecordId });
      expect(page.rows).toHaveLength(0);
    } finally {
      await deleteOrgCascade(otherOrg.id);
    }
  });
});
