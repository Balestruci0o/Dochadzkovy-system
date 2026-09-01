import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/prevádzku/pokrytie priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { coverageRequirements, employeePositionHistory, employees, employeeWorkplaces, generationRuns, organizations, positions, shiftTemplates, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { runGenerateAsCron } from "@/lib/scheduler/run-generate";
import { GET } from "./route";

/**
 * Blok 9d-5 (🔍) — `/api/cron/generate-schedule`. Testuje sa presne to, čo
 * je NOVÉ oproti `runGenerate*` (jadro už otestované v `db-writer.test.ts`/
 * `db-loader.test.ts`): auth gate (rovnaký vzor ako `/api/cron/auto-close`)
 * a "je dnes 7 dní pred koncom mesiaca" gate — OBOJE cez skutočný HTTP
 * handler, keďže sa vždy zastavia PRED akoukoľvek DB zápisovou operáciou.
 *
 * ZÁMERNE sa NETESTUJE úspešný beh CEZ `GET` (route dotazuje VŠETKY aktívne
 * prevádzky v CELEJ zdieľanej dev DB bez filtra — to je jej správny,
 * zámerný dizajn, nie chyba). Spustenie `GET` na 7-dňovej hranici by preto
 * v zdieľanej DB naozaj (re)generovalo júl 2027 aj pre SKUTOČNÉ Hotel/Office
 * dáta pri KAŽDOM behu testov — nechcená mutácia produkčne podobných dát.
 * Samotné "load → generate → persist s `triggeredByUserId = null`" (to, čo
 * `GET` pre KAŽDÚ prevádzku volá) sa preto testuje priamo cez
 * `runGenerateAsCron` na izolovanej testovacej prevádzke, bez prechodu cez
 * `GET`/globálny dotaz.
 *
 * `vi.setSystemTime` mrazí `new Date()` len na strane Node (JS) — Postgres
 * `now()` v samotnej DB tým nie je ovplyvnené, len časovanie testu.
 */

function req(secret?: string): Request {
  return new Request("http://localhost/api/cron/generate-schedule", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("GET /api/cron/generate-schedule — auth", () => {
  it("bez Authorization hlavičky vráti 401", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("so ZLÝM tajomstvom vráti 401", async () => {
    const res = await GET(req("nieco-ine"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/generate-schedule — gate 'je dnes 7 dní pred koncom mesiaca'", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keď DNES nie je 7 dní pred koncom mesiaca, je to no-op (skipped, nie chyba)", async () => {
    vi.setSystemTime(new Date("2027-06-15T10:00:00Z")); // stred mesiaca, ani zďaleka 7 dní pred koncom
    const res = await GET(req(process.env.CRON_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(true);
  });
});

describe("runGenerateAsCron — presne to, čo GET pre KAŽDÚ prevádzku volá (izolovaná testovacia prevádzka)", () => {
  let orgId: string;
  let workplaceId: string;

  beforeAll(async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `cron test org ${crypto.randomUUID()}` }).returning();
    orgId = org.id;
    const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
    workplaceId = wp.id;

    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia" }).returning();
    const [template] = await adminDb
      .insert(shiftTemplates)
      .values({ workplaceId, name: "Denná 8h", code: `D8-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 })
      .returning();
    await adminDb.insert(coverageRequirements).values({
      workplaceId,
      positionId: position.id,
      shiftTemplateId: template.id,
      minPeople: 1,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      appliesHolidays: true,
      isHard: true,
    });
    const [emp] = await adminDb.insert(employees).values({ orgId, firstName: "Cron", lastName: "Test", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: emp.id, workplaceId });
    await adminDb.insert(employeePositionHistory).values({ employeeId: emp.id, positionId: position.id, validFrom: "2024-01-01" });
  });

  afterAll(async () => {
    await deleteOrgCascade(orgId);
  });

  it("vygeneruje rozvrh so shiftsCreated > 0 a generation_runs.triggered_by = NULL (cron, nie je prihlásený používateľ)", async () => {
    const report = await adminDb.transaction((tx) => runGenerateAsCron(tx, workplaceId, 2027, 7));
    expect(report.shiftsCreated).toBeGreaterThan(0);

    const runs = await adminDb.select().from(generationRuns).where(and(eq(generationRuns.workplaceId, workplaceId), eq(generationRuns.year, 2027), eq(generationRuns.month, 7)));
    expect(runs).toHaveLength(1);
    expect(runs[0].triggeredBy).toBeNull();
  });
});
