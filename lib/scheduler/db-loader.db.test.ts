import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/prevádzku/šablóny priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { absences, coverageRequirements, employeePairings, employeePositionHistory, employees, employeeWorkplaces, legalRules, organizations, positions, scheduledShifts, shiftTemplates, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { getOrCreateSchedule } from "@/app/(app)/kalendar/schedule";
import { loadGenerateInput } from "./db-loader";

/**
 * Blok 9d-4 — `coverage_requirements.shift_template_id`
 * (migrácia 0014) rozhoduje, KTORÉ riadky pokrytia sa dostanú do
 * `coverageNeeds`. Testuje sa TU presne táto väzba: riadok BEZ nej (alebo
 * s odkazom na neaktívnu šablónu) sa nezaradí — nezadrátuje sa žiadny
 * odhad — ale ZOSTANE viditeľný v `coverageRequirementsRaw`,
 * nezmizne potichu.
 */

let orgId: string;
let ownerId: string;

// KAŽDÝ test dostane VLASTNÚ prevádzku (coverage_requirements sú viazané len
// na workplaceId, nie na dátum) — bez toho by rovnaká zdieľaná prevádzka
// naprieč testami zmiešala riadky pokrytia z rôznych testov v jednom počte.
async function newWorkplace() {
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  return wp.id;
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `db-loader test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@dbloader-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerId = owner.id;
});

afterAll(async () => {
  // deleteOrgCascade nájde a vynuluje coverage_requirements.position_id
  // (neceskaduje na positions) sama, netreba to tu ručne predchádzať.
  await deleteOrgCascade(orgId);
});

describe("loadGenerateInput — coverageNeeds z coverage_requirements.shift_template_id (9d-4)", () => {
  it("riadok S väzbou na AKTÍVNU šablónu sa zaradí do coverageNeeds s presnými časmi zo šablóny", async () => {
    const workplaceId = await newWorkplace();
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia" }).returning();
    const [template] = await adminDb
      .insert(shiftTemplates)
      .values({ workplaceId, name: "Ranná", code: `R-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 })
      .returning();
    await adminDb.insert(coverageRequirements).values({
      workplaceId,
      positionId: position.id,
      shiftTemplateId: template.id,
      minPeople: 2,
      weekdays: [1, 2, 3, 4, 5],
      appliesHolidays: false,
      isHard: true,
    });

    const { input, counts } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2028, 1));

    expect(counts.coverageRequirementsRaw).toBe(1);
    expect(counts.coverageNeedsUsable).toBe(1);
    expect(input.coverageNeeds).toEqual([
      {
        positionId: position.id,
        minPeople: 2,
        weekdays: [1, 2, 3, 4, 5],
        appliesHolidays: false,
        isHard: true,
        shiftTemplateId: template.id,
        startTime: "07:00:00",
        endTime: "15:00:00",
        crossesMidnight: false,
        breakMinutes: 30,
      },
    ]);
  });

  it("riadok BEZ väzby (shift_template_id NULL) sa NEZARADÍ do coverageNeeds, ale ostane počítaný v coverageRequirementsRaw", async () => {
    const workplaceId = await newWorkplace();
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Bez zmeny" }).returning();
    await adminDb.insert(coverageRequirements).values({
      workplaceId,
      positionId: position.id,
      shiftTemplateId: null,
      minPeople: 1,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      appliesHolidays: true,
      isHard: true,
    });

    const { input, counts } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2028, 2));

    expect(counts.coverageRequirementsRaw).toBe(1);
    expect(counts.coverageNeedsUsable).toBe(0);
    expect(input.coverageNeeds).toEqual([]);
  });

  it("riadok s väzbou na NEAKTÍVNU šablónu sa NEZARADÍ (rovnaké ako chýbajúca väzba)", async () => {
    const workplaceId = await newWorkplace();
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Neaktívna šablóna" }).returning();
    const [inactiveTemplate] = await adminDb
      .insert(shiftTemplates)
      .values({ workplaceId, name: "Zrušená", code: `Z-${crypto.randomUUID().slice(0, 8)}`, startTime: "22:00:00", endTime: "06:00:00", crossesMidnight: true, isActive: false })
      .returning();
    await adminDb.insert(coverageRequirements).values({
      workplaceId,
      positionId: position.id,
      shiftTemplateId: inactiveTemplate.id,
      minPeople: 1,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      appliesHolidays: true,
      isHard: true,
    });

    const { input, counts } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2028, 3));

    expect(counts.coverageRequirementsRaw).toBe(1);
    expect(counts.coverageNeedsUsable).toBe(0);
    expect(input.coverageNeeds).toEqual([]);
  });
});

/**
 * Blok A (carryOverBlock) — `loadGenerateInput` musí načítať
 * REÁLNE priradené zmeny z KONCA predchádzajúceho mesiaca (posledných 14
 * dní pred 1. dňom cieľového mesiaca) ako `priorMonthTailShifts` — jediné,
 * čo sa medzi mesiacmi prenáša. Netýka sa len turnusových zamestnancov —
 * block_length/min_rest_days/MIN_REST_DAILY platia pre všetkých.
 */
describe("loadGenerateInput — priorMonthTailShifts (Blok A, carryOverBlock)", () => {
  it("zmeny z POSLEDNÝCH 14 dní predchádzajúceho mesiaca sa načítajú, staršie NIE", async () => {
    const workplaceId = await newWorkplace();
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia" }).returning();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Chvostová", lastName: "Testovacia", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    await adminDb.insert(employeePositionHistory).values({ employeeId: employee.id, positionId: position.id, validFrom: "2024-01-01" });

    // Cieľový mesiac: 2026-09. Chvost = posledných 14 dní augusta = 2026-08-18 až 2026-08-31.
    const augSchedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, workplaceId, 2026, 8));
    // 30.8. a 31.8. — VNÚTRI 14-dňového okna → MUSIA sa načítať.
    await adminDb.insert(scheduledShifts).values([
      { scheduleId: augSchedule.id, employeeId: employee.id, workplaceId, date: "2026-08-30", startTime: "07:30:00", endTime: "18:30:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true },
      { scheduleId: augSchedule.id, employeeId: employee.id, workplaceId, date: "2026-08-31", startTime: "07:30:00", endTime: "18:30:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true },
    ]);
    // 1.8. — MIMO 14-dňového okna (viac ako 14 dní pred 1.9.) → NESMIE sa načítať.
    await adminDb.insert(scheduledShifts).values({ scheduleId: augSchedule.id, employeeId: employee.id, workplaceId, date: "2026-08-01", startTime: "07:30:00", endTime: "18:30:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true });

    const { input } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));
    const loadedEmployee = input.employees.find((e) => e.id === employee.id);

    const tailDates = loadedEmployee?.priorMonthTailShifts.map((s) => s.date).sort();
    expect(tailDates).toEqual(["2026-08-30", "2026-08-31"]);
  });

  it("nový zamestnanec bez histórie → priorMonthTailShifts = [], nespadne", async () => {
    const workplaceId = await newWorkplace();
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia 2" }).returning();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Nová", lastName: "Testovacia", hiredOn: "2026-09-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    await adminDb.insert(employeePositionHistory).values({ employeeId: employee.id, positionId: position.id, validFrom: "2026-09-01" });

    const { input } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));
    const loadedEmployee = input.employees.find((e) => e.id === employee.id);

    expect(loadedEmployee?.priorMonthTailShifts).toEqual([]);
  });
});

/**
 * Blok 15 (párovanie zamestnancov, Stage 2a) — `employee_pairings` sa
 * nefiltruje na workplaceId (nezávislé od pozície AJ prevádzky), len na
 * employeeId. Kľúčové: keď je partner z INEJ prevádzky, generátor preň
 * negeneruje (nie je v `input.employees`), ale jeho UŽ uložené zmeny sa
 * musia objaviť v `input.externalPartnerShifts` (mäkké skóre ich potrebuje).
 */
describe("loadGenerateInput — párovanie zamestnancov (Blok 15, Stage 2a)", () => {
  it("pár NAPRIEČ POZÍCIAMI v tej istej prevádzke sa načíta do input.pairings", async () => {
    const workplaceId = await newWorkplace();
    const [recepcia, kuchar] = await Promise.all([
      adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia" }).returning().then((r) => r[0]),
      adminDb.insert(positions).values({ orgId, workplaceId, name: "Kuchár" }).returning().then((r) => r[0]),
    ]);
    const [marta] = await adminDb.insert(employees).values({ orgId, firstName: "Marta", lastName: "Recepčná", hiredOn: "2024-01-01" }).returning();
    const [jozef] = await adminDb.insert(employees).values({ orgId, firstName: "Jozef", lastName: "Kuchár", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values([
      { employeeId: marta.id, workplaceId },
      { employeeId: jozef.id, workplaceId },
    ]);
    await adminDb.insert(employeePositionHistory).values([
      { employeeId: marta.id, positionId: recepcia.id, validFrom: "2024-01-01" },
      { employeeId: jozef.id, positionId: kuchar.id, validFrom: "2024-01-01" },
    ]);
    // Zámerne v "obrátenom" poradí ID (appka pri zápise zoraďuje, tu simulujeme oba smery).
    const [a, b] = marta.id < jozef.id ? [marta.id, jozef.id] : [jozef.id, marta.id];
    await adminDb.insert(employeePairings).values({ employeeAId: a, employeeBId: b, isHard: false });

    const { input, counts } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));

    expect(counts.pairings).toBe(1);
    expect(input.pairings).toEqual([{ employeeAId: a, employeeBId: b, isHard: false }]);
    // Obaja sú v TEJTO prevádzke → žiadny "externý" partner.
    expect(input.externalPartnerShifts).toEqual([]);
  });

  it("pár s partnerom z INEJ prevádzky: pár sa načíta, partnerove UŽ uložené zmeny sa objavia v externalPartnerShifts", async () => {
    const workplaceId = await newWorkplace();
    const otherWorkplaceId = await newWorkplace();

    const [marta] = await adminDb.insert(employees).values({ orgId, firstName: "Marta", lastName: "Recepčná", hiredOn: "2024-01-01" }).returning();
    const [zuzana] = await adminDb.insert(employees).values({ orgId, firstName: "Zuzana", lastName: "Wellness", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values([
      { employeeId: marta.id, workplaceId },
      { employeeId: zuzana.id, workplaceId: otherWorkplaceId },
    ]);

    const [a, b] = marta.id < zuzana.id ? [marta.id, zuzana.id] : [zuzana.id, marta.id];
    await adminDb.insert(employeePairings).values({ employeeAId: a, employeeBId: b, isHard: false });

    // Zuzanina zmena v INEJ prevádzke, cieľový mesiac (2026-09) — má sa objaviť ako "externá".
    const zuzanaSchedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, otherWorkplaceId, 2026, 9));
    await adminDb.insert(scheduledShifts).values({
      scheduleId: zuzanaSchedule.id,
      employeeId: zuzana.id,
      workplaceId: otherWorkplaceId,
      date: "2026-09-10",
      startTime: "08:00:00",
      endTime: "16:00:00",
      breakMinutes: 30,
      crossesMidnight: false,
      source: "manual",
      locked: true,
    });

    const { input, counts } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));

    expect(counts.pairings).toBe(1);
    expect(input.pairings).toEqual([{ employeeAId: a, employeeBId: b, isHard: false }]);
    // Zuzana NIE JE zamestnancom TEJTO prevádzky → nie je v input.employees.
    expect(input.employees.some((e) => e.id === zuzana.id)).toBe(false);
    // Ale jej zmena sa objaví ako externá, presne na 2026-09-10.
    expect(input.externalPartnerShifts).toEqual([{ employeeId: zuzana.id, date: "2026-09-10" }]);
  });

  it("Blok 15 (Stage 3a) — pár s partnerom z INEJ prevádzky: jeho meno (externalPartnerNames) a absencia (externalPartnerAbsences) sa načítajú, nezávisle od prevádzky", async () => {
    const workplaceId = await newWorkplace();
    const otherWorkplaceId = await newWorkplace();

    const [marta] = await adminDb.insert(employees).values({ orgId, firstName: "Marta", lastName: "Recepčná", hiredOn: "2024-01-01" }).returning();
    const [zuzana] = await adminDb.insert(employees).values({ orgId, firstName: "Zuzana", lastName: "Wellness", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values([
      { employeeId: marta.id, workplaceId },
      { employeeId: zuzana.id, workplaceId: otherWorkplaceId },
    ]);

    const [a, b] = marta.id < zuzana.id ? [marta.id, zuzana.id] : [zuzana.id, marta.id];
    await adminDb.insert(employeePairings).values({ employeeAId: a, employeeBId: b, isHard: true });

    // Zuzanina absencia v INEJ prevádzke, cieľový mesiac (2026-09).
    await adminDb.insert(absences).values({ employeeId: zuzana.id, workplaceId: otherWorkplaceId, date: "2026-09-15", kind: "dovolenka", isConfirmed: true });

    const { input } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));

    expect(input.externalPartnerNames).toEqual([{ employeeId: zuzana.id, name: "Zuzana Wellness" }]);
    expect(input.externalPartnerAbsences).toEqual([{ employeeId: zuzana.id, date: "2026-09-15" }]);
  });

  it("neaktívny pár (is_active=false) sa NENAČÍTA", async () => {
    const workplaceId = await newWorkplace();
    const [a1] = await adminDb.insert(employees).values({ orgId, firstName: "A", lastName: "Jeden", hiredOn: "2024-01-01" }).returning();
    const [b1] = await adminDb.insert(employees).values({ orgId, firstName: "B", lastName: "Dva", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values([
      { employeeId: a1.id, workplaceId },
      { employeeId: b1.id, workplaceId },
    ]);
    const [a, b] = a1.id < b1.id ? [a1.id, b1.id] : [b1.id, a1.id];
    await adminDb.insert(employeePairings).values({ employeeAId: a, employeeBId: b, isHard: false, isActive: false });

    const { input, counts } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));

    expect(counts.pairings).toBe(0);
    expect(input.pairings).toEqual([]);
  });
});

/**
 * Q10 — "úväzok sa nastavuje per zamestnanec, DEFAULT PLNÝ,
 * prepísateľný". `employees.contract_hours_per_month` nullable = zamestnanec
 * nemá VLASTNÝ prepis → generátor musí použiť "plný úväzok", nie žiadny
 * cieľ. "Plný úväzok" sa berie z `legal_rules.MAX_WEEKLY_HOURS` (dáta, nie
 * zadrátovaná konštanta) prevodom na mesačný, nie z
 * novej hodnoty (zamestnancova vlastná hodnota je od teraz
 * priamo mesačná, konverzia × 4.348125 zostáva len pre tento fallback).
 */
describe("loadGenerateInput — contractedMonthlyHours default (Blok Q10)", () => {
  it("zamestnanec S vlastným contract_hours_per_month: použije sa jeho hodnota priamo, nie MAX_WEEKLY_HOURS", async () => {
    const workplaceId = await newWorkplace();
    // Zámerne BEZ legal_rules riadku — má vlastný contract_hours_per_month,
    // fallback sa vôbec nemá použiť, takže na jeho (ne)existencii nezáleží.
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Polovičný", lastName: "Úväzok", hiredOn: "2024-01-01", contractHoursPerMonth: "90" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });

    const { input } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));
    const loaded = input.employees.find((e) => e.id === employee.id);

    expect(loaded?.contractedMonthlyHours).toBe(90);
  });

  it("zamestnanec BEZ contract_hours_per_month: default PLNÝ úväzok = MAX_WEEKLY_HOURS z legal_rules prevedený na mesačný", async () => {
    const workplaceId = await newWorkplace();
    await adminDb.insert(legalRules).values({ orgId, code: "MAX_WEEKLY_HOURS", name: "Max. týždenne", params: { hours: 40 }, isHard: true });
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Bez", lastName: "Úväzku", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });

    const { input } = await withUserContext(ownerId, (tx) => loadGenerateInput(tx, workplaceId, 2026, 9));
    const loaded = input.employees.find((e) => e.id === employee.id);

    expect(loaded?.contractedMonthlyHours).toBeCloseTo(40 * 4.348125, 5);
  });
});
