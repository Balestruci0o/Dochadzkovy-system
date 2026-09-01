import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/prevádzky/používateľov priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { generationRuns, managerWorkplaces, organizations, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { generateScheduleAction } from "@/app/(app)/kalendar/generate-actions";
import { runGenerateAsUser } from "./run-generate";

/**
 * Skupina D (bezpečnosť end-to-end) — rozšírená o Blok 9d cesty:
 *
 * D1/D3 — manažér Hotela sa cez CELÝ generovací reťazec (`runGenerateAsUser`
 * AJ `generateScheduleAction`) nedostane k prevádzke Office, ani keby si
 * `workplaceId` vo formulári "vyforsoval" (klient nie je hranica dôvery —
 * RLS je).
 *
 * D2 — zamestnanec nedokáže spustiť generovanie. DVOJVRSTVOVO: (a)
 * `generateScheduleAction` ho zastaví na `requireRole` skôr, než sa čokoľvek
 * načíta z DB; (b) AJ KEBY táto aplikačná kontrola chýbala/mala chybu,
 * `runGenerateAsUser` volaný priamo (obchádza requireRole úplne) narazí na
 * `schedules_write`/`generation_runs_write` RLS politiky (migrácia 0004),
 * ktoré vyžadujú `is_owner() OR current_user_role() = 'manager'` — obrana
 * v hĺbke, nezávislá od toho, či aplikačný kód urobil chybu.
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let orgId: string;
let hotelId: string;
let officeId: string;
let managerHotelUserId: string;
let managerHotelAuthUserId: string;
let employeeHotelUserId: string;
let employeeHotelAuthUserId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `run-generate D test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const [hotel, office] = await adminDb
    .insert(workplaces)
    .values([
      { orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` },
      { orgId, name: "Office", code: `OFFICE-${crypto.randomUUID().slice(0, 8)}` },
    ])
    .returning();
  hotelId = hotel.id;
  officeId = office.id;

  managerHotelAuthUserId = crypto.randomUUID();
  employeeHotelAuthUserId = crypto.randomUUID();
  const [managerHotel, employeeHotel] = await adminDb
    .insert(users)
    .values([
      { orgId, authUserId: managerHotelAuthUserId, email: `manager-${crypto.randomUUID()}@rungen-test.local`, role: "manager", fullName: "Manažér Hotel" },
      { orgId, authUserId: employeeHotelAuthUserId, email: `employee-${crypto.randomUUID()}@rungen-test.local`, role: "employee", fullName: "Zamestnanec Hotel" },
    ])
    .returning();
  managerHotelUserId = managerHotel.id;
  employeeHotelUserId = employeeHotel.id;

  await adminDb.insert(managerWorkplaces).values({ userId: managerHotelUserId, workplaceId: hotelId });
  // employeeHotel zámerne NEMÁ employees/employee_workplaces riadok — na tento test
  // netreba (accessible_workplaces() pre employee rolu ide cez employee_workplaces,
  // takže bez neho by mal employeeHotel 0 prístupných prevádzok — čo len POSILŇUJE
  // test D2b, netreba to teda zvlášť seedovať).
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("D1/D3 — manažér Hotela sa NEDOSTANE k prevádzke Office cez generovací reťazec", () => {
  it("runGenerateAsUser(hotelManager, officeId) zlyhá s čitateľnou chybou, žiadny generation_runs riadok nevznikne", async () => {
    await expect(runGenerateAsUser(managerHotelUserId, officeId, 2028, 1)).rejects.toThrow("Prevádzka neexistuje alebo k nej nemáš prístup.");

    const runs = await adminDb.select().from(generationRuns).where(eq(generationRuns.workplaceId, officeId));
    expect(runs).toHaveLength(0);
  });

  it("generateScheduleAction s VYFORSOVANÝM workplaceId=Office (klient nie je hranica dôvery) vráti chybu, nie report", async () => {
    authState.authUserId = managerHotelAuthUserId;
    const form = new FormData();
    form.set("workplaceId", officeId);
    form.set("year", "2028");
    form.set("month", "1");
    const state = await generateScheduleAction({}, form);
    authState.authUserId = null;

    expect(state.error).toBeDefined();
    expect(state.report).toBeUndefined();

    const runs = await adminDb.select().from(generationRuns).where(eq(generationRuns.workplaceId, officeId));
    expect(runs).toHaveLength(0);
  });
});

describe("D2 — zamestnanec nedokáže spustiť generovanie", () => {
  it("(a) generateScheduleAction zamestnanca zastaví na requireRole (NEXT_REDIRECT) skôr, než čokoľvek načíta/zapíše", async () => {
    authState.authUserId = employeeHotelAuthUserId;
    const form = new FormData();
    form.set("workplaceId", hotelId);
    form.set("year", "2028");
    form.set("month", "2");

    await expect(generateScheduleAction({}, form)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    authState.authUserId = null;

    const runs = await adminDb.select().from(generationRuns).where(and(eq(generationRuns.workplaceId, hotelId), eq(generationRuns.year, 2028), eq(generationRuns.month, 2)));
    expect(runs).toHaveLength(0);
  });

  it("(b) obrana v hĺbke: AJ priamo cez runGenerateAsUser (requireRole úplne obídený) zlyhá zápis pre zamestnanca — schedules_write/generation_runs_write vyžadujú owner/manager", async () => {
    await expect(runGenerateAsUser(employeeHotelUserId, hotelId, 2028, 3)).rejects.toThrow();

    const runs = await adminDb.select().from(generationRuns).where(and(eq(generationRuns.workplaceId, hotelId), eq(generationRuns.year, 2028), eq(generationRuns.month, 3)));
    expect(runs).toHaveLength(0);
  });
});
