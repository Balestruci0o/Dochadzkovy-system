"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  absences,
  employeePositionHistory,
  employees,
  publishedShifts,
  schedules,
  scheduledShifts,
  shiftLeaderAssignments,
  scheduleViolations,
  shiftTemplates,
  workplaces,
} from "@/lib/db/schema";
import { notifyManualOverrideApplied, notifySchedulePublished } from "@/lib/notifications/events";
import { checkManualAssignment } from "@/lib/scheduler/manual-check";
import { resolveBreakOverride } from "@/lib/shared/break-override";
import type { AbsenceKind } from "@/components/calendar/absence-kinds";
import { getOrCreateSchedule } from "./schedule";

function parseDate(date: string): { year: number; month: number } {
  const [y, m] = date.split("-").map(Number);
  return { year: y, month: m };
}

export type AssignShiftState = {
  /** Neprázdne = "toto by porušilo pravidlo" — ZATIAĽ NEZAPÍSANÉ, čaká na `confirmOverride`. */
  violations?: { code: string; message: string; isHard: boolean }[];
  success?: boolean;
};

/**
 * Ručne priradená zmena — vždy `source = 'manual'`, `locked = true`.
 * Generátor (Blok 9) takéto zmeny nikdy neprepíše.
 * Zruší prípadnú absenciu v ten istý deň — deň je buď zmena, alebo absencia.
 *
 * Q3 — "obsaď aj tak, len upozorni". Predtým táto akcia
 * vkladala zmenu úplne bez kontroly pravidiel (na rozdiel od generátora,
 * ktorý cez `evaluateRules` beží vždy). Teraz: PRED zápisom vždy spustí
 * ROVNAKÝ `evaluateRules` (cez `checkManualAssignment`) na TENTO konkrétny
 * deň. Ak nájde porušenie A klient ešte NEPOSLAL `confirmOverride=true`,
 * NIČ nezapíše — vráti porušenia späť, nech ich manažér VIDÍ. Manažér sa
 * SLOBODNE rozhodne obsadiť aj tak (druhý klik, `confirmOverride=true`) —
 * to je vedomé manuálne rozhodnutie ČLOVEKA, nie generátor, ktorý si sám
 * vyberá "najmenšie zlo" (to je zakázané len pri AUTOMATICKOM generovaní,
 * tu nie). Pri potvrdení sa VŽDY prepočíta odznova
 * (nikdy sa neverí hodnotám z klienta) a KAŽDÉ prijaté porušenie sa zapíše
 * do `schedule_violations` (`ruleSource: "manual_override"`) — nech to
 * nezmizne potichu, manažér/owner ho uvidí v tom istom zozname upozornení,
 * ktorý už kalendár zobrazuje pre generátorové diery.
 *
 * `breakMinutes` je VOLITEĽNÝ prepis šablóny pre TOTO KONKRÉTNE priradenie
 * (manažér vie prestávku individuálne zmeniť oproti default hodnote zo
 * šablóny) — chýbajúca/neplatná hodnota padne späť na `template.breakMinutes`
 * (`resolveBreakOverride`). Rovnaký formulár slúži aj na ÚPRAVU už priradenej
 * zmeny (`onConflictDoUpdate`) — opätovné odoslanie s inou hodnotou prestávky
 * prepíše tú predošlú.
 */
export async function assignShiftAction(_prevState: AssignShiftState, formData: FormData): Promise<AssignShiftState> {
  const user = await requireRole("owner", "manager");

  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  const date = String(formData.get("date") ?? "");
  const shiftTemplateId = String(formData.get("shiftTemplateId") ?? "");
  const confirmOverride = formData.get("confirmOverride") === "true";

  if (!employeeId || !workplaceId || !date || !shiftTemplateId) return {};
  const { year, month } = parseDate(date);

  const result = await withUserContext(user.id, async (tx): Promise<AssignShiftState> => {
    const [template] = await tx.select().from(shiftTemplates).where(eq(shiftTemplates.id, shiftTemplateId));
    if (!template) return {};

    const breakMinutes = resolveBreakOverride(formData.get("breakMinutes"), template.breakMinutes);
    const candidateShift = { startTime: template.startTime, endTime: template.endTime, crossesMidnight: template.crossesMidnight, breakMinutes };

    const violations = await checkManualAssignment(tx, { employeeId, workplaceId, date, shift: candidateShift });

    if (violations.length > 0 && !confirmOverride) {
      return { violations: violations.map((v) => ({ code: v.code, message: v.message, isHard: v.isHard })) };
    }

    const schedule = await getOrCreateSchedule(tx, workplaceId, year, month);

    await tx.delete(absences).where(and(eq(absences.employeeId, employeeId), eq(absences.date, date)));

    await tx
      .insert(scheduledShifts)
      .values({
        scheduleId: schedule.id,
        employeeId,
        workplaceId,
        date,
        shiftTemplateId,
        startTime: template.startTime,
        endTime: template.endTime,
        breakMinutes,
        crossesMidnight: template.crossesMidnight,
        source: "manual",
        locked: true,
        createdBy: user.id,
      })
      .onConflictDoUpdate({
        target: [scheduledShifts.employeeId, scheduledShifts.workplaceId, scheduledShifts.date],
        set: {
          scheduleId: schedule.id,
          shiftTemplateId,
          startTime: template.startTime,
          endTime: template.endTime,
          breakMinutes,
          crossesMidnight: template.crossesMidnight,
          source: "manual",
          locked: true,
          createdBy: user.id,
        },
      });

    if (violations.length > 0) {
      // Predošlé nevyriešené upozornenia PRESNE na tento deň/človeka (z
      // predošlého manuálneho obsadenia) už neplatia — táto zmena ich nahrádza.
      await tx
        .update(scheduleViolations)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(
          and(
            eq(scheduleViolations.scheduleId, schedule.id),
            eq(scheduleViolations.date, date),
            eq(scheduleViolations.employeeId, employeeId),
            eq(scheduleViolations.ruleSource, "manual_override"),
            eq(scheduleViolations.resolved, false),
          ),
        );

      await tx.insert(scheduleViolations).values(
        violations.map((v) => ({
          scheduleId: schedule.id,
          date,
          employeeId,
          severity: v.isHard ? ("hard_violation" as const) : ("soft_violation" as const),
          ruleCode: v.code,
          ruleSource: "manual_override",
          message: `Manuálne priradené AJ TAK (potvrdil ${user.fullName}): ${v.message}`,
        })),
      );

      const [workplace] = await tx.select().from(workplaces).where(eq(workplaces.id, workplaceId));
      const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId));
      if (workplace && employee) {
        await notifyManualOverrideApplied(tx, {
          orgId: workplace.orgId,
          workplaceId,
          workplaceName: workplace.name,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          date,
          managerName: user.fullName,
          violations,
        });
      }
    }

    return { success: true };
  });

  revalidatePath("/kalendar");
  return result;
}

/**
 * Absencia zadaná priamo z kalendára manažérom/ownerom — materializovaná
 * rovno do `absences` (bez `absence_requests`, ten tok je Blok 10) a hneď
 * potvrdená (`is_confirmed = true`), keďže ju zadáva ten, kto by ju aj
 * schvaľoval. Zruší prípadnú naplánovanú zmenu v ten istý deň.
 */
export async function assignAbsenceAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner", "manager");

  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  const date = String(formData.get("date") ?? "");
  const kind = String(formData.get("kind") ?? "") as AbsenceKind;

  if (!employeeId || !workplaceId || !date || !kind) return;

  await withUserContext(user.id, async (tx) => {
    await tx
      .delete(scheduledShifts)
      .where(
        and(
          eq(scheduledShifts.employeeId, employeeId),
          eq(scheduledShifts.workplaceId, workplaceId),
          eq(scheduledShifts.date, date),
        ),
      );

    await tx
      .insert(absences)
      .values({ employeeId, workplaceId, date, kind, isConfirmed: true })
      .onConflictDoUpdate({
        target: [absences.employeeId, absences.date],
        set: { workplaceId, kind, isConfirmed: true },
      });
  });

  revalidatePath("/kalendar");
}

/** Voľno / vymazať bunku — zruší zmenu aj absenciu v ten deň. */
export async function clearCellAction(formData: FormData) {
  const user = await requireRole("owner", "manager");

  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!employeeId || !workplaceId || !date) return;

  await withUserContext(user.id, async (tx) => {
    await tx
      .delete(scheduledShifts)
      .where(
        and(
          eq(scheduledShifts.employeeId, employeeId),
          eq(scheduledShifts.workplaceId, workplaceId),
          eq(scheduledShifts.date, date),
        ),
      );
    await tx.delete(absences).where(and(eq(absences.employeeId, employeeId), eq(absences.date, date)));
  });

  revalidatePath("/kalendar");
}

/**
 * "Nový rozvrh zverejnený" notifikácia potrebuje
 * reálnu udalosť, ktorá sa dá spustiť — `schedules.status` (draft/published,
 * existuje od Bloku 6) doteraz nemalo žiadny prepínač. Zámerne minimálne:
 * len prepnutie statusu + notifikácia KAŽDÉMU zamestnancovi s aspoň jednou
 * zmenou v tomto rozvrhu — nie plnohodnotný "zamkni úpravy po zverejnení"
 * tok (nebolo vyžiadané).
 */
/**
 * Zverejnenie rozvrhu, krok 1 — okrem `schedules.status = 'published'`
 * teraz NAKOPÍRUJE aktuálny obsah `scheduled_shifts` (živý pracovný návrh)
 * do `published_shifts` (zrkadlová snímka, ktorú číta VÝHRADNE zamestnanec,
 * `moj-rozvrh/data.ts`). Najprv zmaže STARÚ snímku tohto rozvrhu (predošlé
 * zverejnenie, ak nejaké bolo) a nahradí ju úplne novou — "zverejniť" je
 * vždy CELÝ prepis snímky, nie diff. Medzi zverejneniami (kým manažér
 * pripravuje ďalší návrh, prípadne ho pregeneruje) sa `published_shifts`
 * VÔBEC nedotkne — zamestnanec preto vidí posledný zverejnený stav AJ POČAS
 * prípravy nového návrhu, presne ako pri prvom generovaní.
 */
export async function publishScheduleAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner", "manager");

  const workplaceId = String(formData.get("workplaceId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!workplaceId || !date) return;
  const { year, month } = parseDate(date);

  await withUserContext(user.id, async (tx) => {
    const schedule = await getOrCreateSchedule(tx, workplaceId, year, month);

    const currentShifts = await tx.select().from(scheduledShifts).where(eq(scheduledShifts.scheduleId, schedule.id));

    await tx.delete(publishedShifts).where(eq(publishedShifts.scheduleId, schedule.id));
    if (currentShifts.length > 0) {
      await tx.insert(publishedShifts).values(
        currentShifts.map((s) => ({
          scheduleId: schedule.id,
          employeeId: s.employeeId,
          workplaceId: s.workplaceId,
          date: s.date,
          shiftTemplateId: s.shiftTemplateId,
          startTime: s.startTime,
          endTime: s.endTime,
          breakMinutes: s.breakMinutes,
          crossesMidnight: s.crossesMidnight,
          publishedBy: user.id,
        })),
      );
    }

    await tx.update(schedules).set({ status: "published" }).where(eq(schedules.id, schedule.id));

    const [workplace] = await tx.select({ name: workplaces.name }).from(workplaces).where(eq(workplaces.id, workplaceId));
    await notifySchedulePublished(tx, { scheduleId: schedule.id, workplaceName: workplace?.name ?? "", year, month });
  });

  revalidatePath("/kalendar");
  revalidatePath("/moj-rozvrh");
}

export type AssignShiftLeaderState = {
  /** Neprázdne = "táto osoba nemá can_be_shift_leader" — ZATIAĽ NEZAPÍSANÉ, čaká na `confirmOverride`. */
  violations?: { code: string; message: string; isHard: boolean }[];
  /** Tvrdá chyba (chýbajúce údaje, cieľ NIE JE reálne priradený na tú pozíciu/deň) — NEDÁ sa "potvrdiť AJ TAK". */
  error?: string;
  success?: boolean;
};

/**
 * Vedúci smeny, krok 5 — ručný prepis vedúceho manažérom/ownerom, NEZÁVISLE
 * od generátora (kroky 2–4, `lib/scheduler/shift-leader.ts`). `employeeId`
 * prázdne/chýbajúce z formulára je VEDOMÁ voľba "žiadny vedúci" (zapíše sa
 * `employee_id: null, source: 'manual'`) — ODLÍŠENÁ od generátorovej diery
 * (`schedule_violations`, `rule_code: 'NO_SHIFT_LEADER'`, čo znamená "nikto
 * oprávnený nepracoval"): toto je vedomé rozhodnutie manažéra, žiadny
 * záznam do `schedule_violations` sa preň nepíše.
 *
 * DVE odlišné úrovne kontroly cieľového zamestnanca:
 * 1. MUSÍ byť v ten deň na TEJTO pozícii reálne priradený (scheduled_shifts
 *    + aktuálna pozícia z employee_position_history) — TVRDÁ chyba, nedá sa
 *    obísť potvrdením (nedáva zmysel urobiť vedúcim niekoho, kto tam vôbec
 *    nepracuje).
 * 2. `can_be_shift_leader` — MÄKKÉ upozornenie, rovnaký Q3 vzor
 *    ako `assignShiftAction` ("obsaď aj tak, len upozorni"): manažér má
 *    posledné slovo, systém len upozorní a čaká na `confirmOverride=true`.
 *
 * `onConflictDoUpdate` BEZ `setWhere` — na rozdiel od generátorového writeru
 * (`shift-leader-writer.ts`, ten `source='manual'` NIKDY neprepíše), TENTO
 * ručný prepis SMIE prepísať aj predchádzajúce ručné rozhodnutie (manažér si
 * to rozmyslel) aj generátorové — je to najvyššia autorita v reťazci.
 */
export async function assignShiftLeaderAction(_prevState: AssignShiftLeaderState, formData: FormData): Promise<AssignShiftLeaderState> {
  const user = await requireRole("owner", "manager");

  const workplaceId = String(formData.get("workplaceId") ?? "");
  const positionId = String(formData.get("positionId") ?? "");
  const date = String(formData.get("date") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const confirmOverride = formData.get("confirmOverride") === "true";

  if (!workplaceId || !positionId || !date) return { error: "Chýbajú povinné údaje." };
  const { year, month } = parseDate(date);

  const result = await withUserContext(user.id, async (tx): Promise<AssignShiftLeaderState> => {
    if (employeeId) {
      const [shift] = await tx
        .select({ id: scheduledShifts.id })
        .from(scheduledShifts)
        .where(and(eq(scheduledShifts.employeeId, employeeId), eq(scheduledShifts.workplaceId, workplaceId), eq(scheduledShifts.date, date)));
      if (!shift) return { error: "Tento zamestnanec nemá v tento deň na tejto prevádzke priradenú zmenu." };

      const [currentPosition] = await tx
        .select({ positionId: employeePositionHistory.positionId })
        .from(employeePositionHistory)
        .where(and(eq(employeePositionHistory.employeeId, employeeId), isNull(employeePositionHistory.validTo)));
      if (currentPosition?.positionId !== positionId) {
        return { error: "Tento zamestnanec momentálne nie je na pozícii, ktorá vedúceho vyžaduje." };
      }

      const [employee] = await tx.select({ canBeShiftLeader: employees.canBeShiftLeader }).from(employees).where(eq(employees.id, employeeId));
      if (!employee?.canBeShiftLeader && !confirmOverride) {
        return { violations: [{ code: "NOT_ELIGIBLE", message: 'Tento zamestnanec nemá označenie "môže byť vedúci".', isHard: false }] };
      }
    }

    const schedule = await getOrCreateSchedule(tx, workplaceId, year, month);

    await tx
      .insert(shiftLeaderAssignments)
      .values({ scheduleId: schedule.id, workplaceId, positionId, date, employeeId, source: "manual", decidedBy: user.id, decidedAt: new Date(), note })
      .onConflictDoUpdate({
        target: [shiftLeaderAssignments.workplaceId, shiftLeaderAssignments.positionId, shiftLeaderAssignments.date],
        set: { scheduleId: schedule.id, employeeId, source: "manual", decidedBy: user.id, decidedAt: new Date(), note },
      });

    return { success: true };
  });

  revalidatePath("/kalendar");
  return result;
}
