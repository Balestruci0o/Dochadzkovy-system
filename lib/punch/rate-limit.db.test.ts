import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá dáta priamo, mimo bežného app.user_id toku (rovnaká výnimka ako route.ts)
import { adminDb } from "@/lib/db/admin";
import { employees, organizations, punchEvents, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { checkPunchRateLimit } from "./rate-limit";

/**
 * Priame testy `checkPunchRateLimit` cez syntetické riadky v
 * `punch_events` (bulk insert, nie 20/300 skutočných HTTP requestov —
 * end-to-end drôtovanie cez skutočný POST /api/punch overuje samostatný
 * test v punch.test.ts, tu ide o presnú hranicu oboch limitov naraz).
 *
 * `punch_events` je append-only — org sa preto na
 * konci NEMAŽE, rovnaký dôvod ako v punch.test.ts.
 */

let orgId: string;
let workplaceId: string;

async function freshEmployee(name: string) {
  const [row] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: name, lastName: "Testovací", hiredOn: "2024-01-01" })
    .returning();
  return row.id;
}

async function insertSyntheticPunches(employeeId: string, ip: string | null, count: number) {
  if (count === 0) return;
  await adminDb.insert(punchEvents).values(
    Array.from({ length: count }, () => ({
      employeeId,
      workplaceId,
      direction: "in" as const,
      method: "manual" as const,
      occurredAt: new Date(),
      ip,
    })),
  );
}

beforeAll(async () => {
  const [org] = await adminDb
    .insert(organizations)
    .values({ name: `Punch rate-limit test org ${crypto.randomUUID()}` })
    .returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("checkPunchRateLimit — podľa employee_id (tesný limit, 20/60s)", () => {
  it("povolí bez predchádzajúcich razítok", async () => {
    const empId = await freshEmployee("Employee-OK");
    const result = await checkPunchRateLimit(empId, null);
    expect(result.allowed).toBe(true);
  });

  it("zablokuje presne na 20. razítku za posledných 60s", async () => {
    const empId = await freshEmployee("Employee-19");
    await insertSyntheticPunches(empId, null, 19);
    expect((await checkPunchRateLimit(empId, null)).allowed).toBe(true);

    await insertSyntheticPunches(empId, null, 1); // teraz 20
    const result = await checkPunchRateLimit(empId, null);
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("razítok") });
  });

  it("iný zamestnanec na tom istom termináli/IP nie je cudzím počtom ovplyvnený", async () => {
    const spammer = await freshEmployee("Spammer");
    await insertSyntheticPunches(spammer, null, 25);
    expect((await checkPunchRateLimit(spammer, null)).allowed).toBe(false);

    const bystander = await freshEmployee("Bystander");
    expect((await checkPunchRateLimit(bystander, null)).allowed).toBe(true);
  });

  it("null employeeId (JWT sa nedal dekódovať) — kontrola podľa zamestnanca sa preskočí", async () => {
    const result = await checkPunchRateLimit(null, null);
    expect(result.allowed).toBe(true);
  });
});

describe("checkPunchRateLimit — podľa IP (veľmi voľný strop, 300/60s)", () => {
  it("jeden terminál/budova s mnohými rôznymi zamestnancami pod stropom prejde", async () => {
    const filler = await freshEmployee("IP-filler-1");
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    await insertSyntheticPunches(filler, ip, 299);

    const freshWorker = await freshEmployee("IP-fresh-worker");
    const result = await checkPunchRateLimit(freshWorker, ip);
    expect(result.allowed).toBe(true); // 299 < 300, aj keď freshWorker sám nemá žiadne
  });

  it("nad stropom (300) je zablokovaná AJ celkom čerstvá zamestnankyňa na tej istej IP", async () => {
    const filler = await freshEmployee("IP-filler-2");
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    await insertSyntheticPunches(filler, ip, 300);

    const freshWorker = await freshEmployee("IP-fresh-worker-2");
    const result = await checkPunchRateLimit(freshWorker, ip);
    expect(result.allowed).toBe(false); // strop je na IP, nie na zamestnanca — aj nulový počet ho nezachráni
  });

  it("iná IP nie je ovplyvnená zaplavením prvej", async () => {
    const filler = await freshEmployee("IP-filler-3");
    const busyIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    await insertSyntheticPunches(filler, busyIp, 300);
    expect((await checkPunchRateLimit(null, busyIp)).allowed).toBe(false);

    const quietIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    expect((await checkPunchRateLimit(null, quietIp)).allowed).toBe(true);
  });

  it("null ip (napr. hlavičky chýbajú) — kontrola podľa IP sa preskočí", async () => {
    const result = await checkPunchRateLimit(null, null);
    expect(result.allowed).toBe(true);
  });
});

describe("checkPunchRateLimit — obe kontroly nezávisle (ktorákoľvek zablokuje)", () => {
  it("zamestnanec pod svojím limitom, ale nad IP stropom — zablokované kvôli IP", async () => {
    const filler = await freshEmployee("Combo-filler");
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    await insertSyntheticPunches(filler, ip, 300);

    const emp = await freshEmployee("Combo-employee");
    await insertSyntheticPunches(emp, ip, 5); // ďaleko pod 20
    const result = await checkPunchRateLimit(emp, ip);
    expect(result.allowed).toBe(false);
  });
});
