"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createEmployeeAccountWithPassword } from "@/lib/auth/create-account-with-password";
import { createEmployeeAccountAndInvite, resendAccountInvite } from "@/lib/auth/invite-employee";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  employeePositionHistory,
  employeeRateHistory,
  employees,
  employeeWorkplaces,
  users,
} from "@/lib/db/schema";

export type EmployeeFormState = { error?: string };

function parseNumeric(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}

/**
 * Zámerné poradie: employees → employee_workplaces → position/rate history.
 * `employees_insert_manager`/`employee_position_history_write` RLS politiky
 * pre manažéra vyžadujú, aby employee_workplaces UŽ existoval (inak by
 * manažér nikdy nemohol založiť prvého zamestnanca ani mu priradiť pozíciu
 * — presne ten "sliepka a vajce" problém, čo sme riešili aj pri
 * users_insert_manager). ID generujeme sami namiesto .returning() po
 * INSERTe do employees — RLS by ho manažérovi hneď po vzniku ešte
 * neukázala (chýba jej employee_workplaces záznam), takže by RETURNING
 * zlyhalo presne z rovnakého dôvodu.
 */
export async function createEmployeeAction(
  _prevState: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const user = await requireRole("owner", "manager");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const personalNumber = String(formData.get("personalNumber") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const hiredOn = String(formData.get("hiredOn") ?? "").trim();
  const contractHoursPerMonth = parseNumeric(formData.get("contractHoursPerMonth"));
  const contractType = String(formData.get("contractType") ?? "").trim() || null;
  const vacationDaysPerYear = parseNumeric(formData.get("vacationDaysPerYear")) ?? "20";
  const workplaceId = String(formData.get("workplaceId") ?? "").trim();
  const positionId = String(formData.get("positionId") ?? "").trim() || null;
  const hourlyRate = parseNumeric(formData.get("hourlyRate"));
  // "none" | "invite" | "password" — relevantné len keď je vyplnený email,
  // inak sa jednoducho ignoruje. Predvolené "invite" matchuje pôvodné
  // predvolene zapnuté "poslať pozvánku" správanie.
  const accountModeRaw = String(formData.get("accountMode") ?? "invite");
  const accountMode = accountModeRaw === "password" || accountModeRaw === "none" ? accountModeRaw : "invite";
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (!firstName || !lastName) return { error: "Vyplň meno aj priezvisko." };
  if (!hiredOn) return { error: "Vyplň dátum nástupu." };
  if (!workplaceId) return { error: "Vyber aspoň jednu prevádzku." };
  if (hourlyRate && user.role !== "owner") {
    return { error: "Hodinovú sadzbu smie nastaviť len majiteľ — nechaj ju prázdnu, doplní ju neskôr." };
  }
  if (accountMode === "password" && email && password !== passwordConfirm) {
    return { error: "Heslá sa nezhodujú." };
  }

  const employeeId = crypto.randomUUID();

  // Založenie zamestnanca NIKDY nezlyhá kvôli pozvánke — `createEmployeeAccountAndInvite`
  // vracia výsledok namiesto hádzania, takže transakcia vždy commitne
  // employees/workplace/position/rate riadky bez ohľadu na to, či konto/email vyšlo.
  const inviteOutcome = await withUserContext(user.id, async (tx) => {
    await tx.insert(employees).values({
      id: employeeId,
      orgId: user.orgId,
      firstName,
      lastName,
      personalNumber,
      phone,
      email,
      hiredOn,
      contractHoursPerMonth,
      contractType,
      vacationDaysPerYear,
      createdBy: user.id,
    });

    await tx.insert(employeeWorkplaces).values({ employeeId, workplaceId, isPrimary: true });

    if (positionId) {
      await tx.insert(employeePositionHistory).values({
        employeeId,
        positionId,
        validFrom: hiredOn,
        createdBy: user.id,
      });
    }

    if (hourlyRate) {
      await tx.insert(employeeRateHistory).values({
        employeeId,
        workplaceId,
        hourlyRate,
        validFrom: hiredOn,
        createdBy: user.id,
      });
    }

    if (accountMode === "invite" && email) {
      return createEmployeeAccountAndInvite(tx, { employeeId, orgId: user.orgId, email, fullName: `${firstName} ${lastName}` });
    }
    if (accountMode === "password" && email) {
      return createEmployeeAccountWithPassword(tx, { employeeId, orgId: user.orgId, email, fullName: `${firstName} ${lastName}`, password });
    }
    return null;
  });

  if (inviteOutcome && !inviteOutcome.ok) {
    redirect(`/zamestnanci/${employeeId}?accountError=${encodeURIComponent(inviteOutcome.message)}`);
  }
  redirect(`/zamestnanci/${employeeId}`);
}

/**
 * "Pozvať do systému" tlačidlo na profile zamestnanca BEZ konta
 * (`employees.user_id IS NULL`) — pre existujúcich zamestnancov (napr.
 * založených pred touto funkciou), ktorí email majú, ale nikdy nedostali
 * pozvánku. Nikdy sa nespúšťa automaticky, len na explicitný klik.
 */
export async function inviteEmployeeAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return;

  const outcome = await withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!employee) return { ok: false as const, message: "Zamestnanec neexistuje." };
    if (employee.userId) return { ok: false as const, message: "Zamestnanec už má prihlasovacie konto." };
    if (!employee.email) return { ok: false as const, message: "Zamestnanec nemá vyplnený email — najprv ho doplň." };

    return createEmployeeAccountAndInvite(tx, {
      employeeId,
      orgId: user.orgId,
      email: employee.email,
      fullName: `${employee.firstName} ${employee.lastName}`,
    });
  });

  redirect(
    outcome.ok
      ? `/zamestnanci/${employeeId}?accountSuccess=1`
      : `/zamestnanci/${employeeId}?accountError=${encodeURIComponent(outcome.message)}`,
  );
}

/**
 * "Nastaviť heslo teraz" — obchádza email/pozvánkový tok úplne (Supabase
 * Admin API generateLink/createUser vie zlyhať ~10-20%, viď incident s
 * hafanabafana3@gmail.com). Owner/manažér zadá heslo priamo, konto vznikne
 * HNEĎ aktívne. Rovnaké guardy ako `inviteEmployeeAction` (bez konta, email
 * vyplnený), len iný spôsob jeho vytvorenia.
 */
export async function setEmployeePasswordAction(
  _prevState: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  if (!employeeId) return { error: "Chýba ID zamestnanca." };
  if (password !== passwordConfirm) return { error: "Heslá sa nezhodujú." };

  const outcome = await withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!employee) return { ok: false as const, message: "Zamestnanec neexistuje." };
    if (employee.userId) return { ok: false as const, message: "Zamestnanec už má prihlasovacie konto." };
    if (!employee.email) return { ok: false as const, message: "Zamestnanec nemá vyplnený email — najprv ho doplň." };

    return createEmployeeAccountWithPassword(tx, {
      employeeId,
      orgId: user.orgId,
      email: employee.email,
      fullName: `${employee.firstName} ${employee.lastName}`,
      password,
    });
  });

  if (!outcome.ok) return { error: outcome.message };
  redirect(`/zamestnanci/${employeeId}?accountSuccess=1`);
}

/**
 * "Poslať pozvánku znova" — pre konto, ktoré UŽ existuje, ale zamestnanec si
 * ešte nenastavil heslo (`activated_at IS NULL`). Nový `generateLink`
 * (čerstvý odkaz), nie nový `users` riadok.
 */
export async function resendInviteAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return;

  const outcome = await withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!employee?.userId) return { ok: false as const, message: "Zamestnanec nemá prihlasovacie konto." };
    if (!employee.email) return { ok: false as const, message: "Zamestnanec nemá vyplnený email." };

    const [account] = await tx.select().from(users).where(eq(users.id, employee.userId));
    if (!account) return { ok: false as const, message: "Konto sa nenašlo." };
    if (account.activatedAt) {
      return { ok: false as const, message: "Konto je už aktívne — pozvánku netreba posielať znova." };
    }

    return resendAccountInvite(tx, {
      userId: account.id,
      email: employee.email,
      fullName: `${employee.firstName} ${employee.lastName}`,
    });
  });

  redirect(
    outcome.ok
      ? `/zamestnanci/${employeeId}?accountSuccess=1`
      : `/zamestnanci/${employeeId}?accountError=${encodeURIComponent(outcome.message)}`,
  );
}

export async function updateEmployeeAction(
  _prevState: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return { error: "Chýba ID zamestnanca." };

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  if (!firstName || !lastName) return { error: "Vyplň meno aj priezvisko." };

  const personalNumber = String(formData.get("personalNumber") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const contractHoursPerMonth = parseNumeric(formData.get("contractHoursPerMonth"));
  const contractType = String(formData.get("contractType") ?? "").trim() || null;
  const vacationDaysPerYear = parseNumeric(formData.get("vacationDaysPerYear")) ?? "20";
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const workTimeModeRaw = String(formData.get("workTimeMode") ?? "").trim();
  const workTimeMode = workTimeModeRaw === "nerovnomerny_turnus" ? "nerovnomerny_turnus" as const : "rovnomerny" as const;
  const balancingPeriodMonthsRaw = Number(formData.get("balancingPeriodMonths"));
  const balancingPeriodMonths = Number.isInteger(balancingPeriodMonthsRaw) && balancingPeriodMonthsRaw > 0 ? balancingPeriodMonthsRaw : 4;

  const overrideBreakTrackingModeRaw = String(formData.get("overrideBreakTrackingMode") ?? "").trim();
  const overrideBreakTrackingMode = overrideBreakTrackingModeRaw === "automaticky" || overrideBreakTrackingModeRaw === "pipa" ? overrideBreakTrackingModeRaw : null;

  const overrideDepartureModeRaw = String(formData.get("overrideDepartureMode") ?? "").trim();
  const overrideDepartureMode = overrideDepartureModeRaw === "pipa" || overrideDepartureModeRaw === "nepipa" ? overrideDepartureModeRaw : null;

  const overridePayModeRaw = String(formData.get("overridePayMode") ?? "").trim();
  const overridePayMode = overridePayModeRaw === "hodinovy" || overridePayModeRaw === "fixny" ? overridePayModeRaw : null;

  const canPunchWeb = formData.get("canPunchWeb") === "on";
  const canBeShiftLeader = formData.get("canBeShiftLeader") === "on";

  await withUserContext(user.id, (tx) =>
    tx
      .update(employees)
      .set({
        firstName,
        lastName,
        personalNumber,
        phone,
        email,
        contractHoursPerMonth,
        contractType,
        vacationDaysPerYear,
        notes,
        workTimeMode,
        balancingPeriodMonths,
        overrideBreakTrackingMode,
        overrideDepartureMode,
        overridePayMode,
        canPunchWeb,
        canBeShiftLeader,
      })
      .where(eq(employees.id, employeeId)),
  );

  redirect(`/zamestnanci/${employeeId}`);
}

export async function deactivateEmployeeAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const terminatedOn =
    String(formData.get("terminatedOn") ?? "").trim() || new Date().toISOString().slice(0, 10);

  await withUserContext(user.id, (tx) =>
    tx.update(employees).set({ isActive: false, terminatedOn }).where(eq(employees.id, employeeId)),
  );

  redirect(`/zamestnanci/${employeeId}`);
}

export async function reactivateEmployeeAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");

  await withUserContext(user.id, (tx) =>
    tx.update(employees).set({ isActive: true, terminatedOn: null }).where(eq(employees.id, employeeId)),
  );

  redirect(`/zamestnanci/${employeeId}`);
}
