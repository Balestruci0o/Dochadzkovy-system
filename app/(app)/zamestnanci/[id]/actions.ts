"use server";

import {
  RULE_TYPE_CONFIG,
  validateRuleParams,
  type AvailabilityRuleType,
} from "@/components/employees/availability-rule-types";
import { requirePermission, requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  employeeAvailabilityRules,
  employeePairings,
  employeePositionHistory,
  employeeRateHistory,
  employeeSalaryHistory,
  employees,
  employeeWorkplaces,
  users,
} from "@/lib/db/schema";
import { sortPairIds } from "@/lib/employees/pairings";
import { isForeignKeyViolation, requestDeleteCode, verifyDeleteCode } from "@/lib/settings/delete-with-code";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ActionState = { error?: string; success?: string };

function isExclusionViolation(err: unknown): boolean {
  const cause = err instanceof Error ? ((err as { cause?: unknown }).cause ?? err.message) : err;
  return /exclusion|prekrýva/i.test(String(cause));
}

// ----------------------------------------------------------------------------
// História pozícií — zavri starú (valid_to = nový dátum), otvor novú.
// Nikdy sa neprepisuje.
// ----------------------------------------------------------------------------
export async function changePositionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const positionId = String(formData.get("positionId") ?? "");
  const validFrom = String(formData.get("validFrom") ?? "").trim();

  if (!positionId) return { error: "Vyber pozíciu." };
  if (!validFrom) return { error: "Zadaj dátum, od kedy pozícia platí." };

  const current = await withUserContext(user.id, (tx) =>
    tx
      .select()
      .from(employeePositionHistory)
      .where(
        and(
          eq(employeePositionHistory.employeeId, employeeId),
          isNull(employeePositionHistory.validTo),
        ),
      ),
  );

  if (current[0] && validFrom <= current[0].validFrom) {
    return { error: "Nový dátum musí byť po začiatku súčasnej pozície." };
  }

  try {
    await withUserContext(user.id, async (tx) => {
      if (current[0]) {
        await tx
          .update(employeePositionHistory)
          .set({ validTo: validFrom })
          .where(eq(employeePositionHistory.id, current[0].id));
      }
      await tx.insert(employeePositionHistory).values({
        employeeId,
        positionId,
        validFrom,
        createdBy: user.id,
      });
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      return { error: "Obdobia pozícií sa prekrývajú — over dátum." };
    }
    throw err;
  }

  revalidatePath(`/zamestnanci/${employeeId}`);
  return { success: "Pozícia zmenená." };
}

// ----------------------------------------------------------------------------
// História sadzieb — rovnaký princíp, per prevádzka. Owner ALEBO manažér s
// `edit_wages` (RLS rate_write, migrácia 0050, vynúti presne to isté +
// scoping na vlastnú prevádzku — toto je len rýchla spätná väzba v UI).
// ----------------------------------------------------------------------------
export async function changeRateAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("editWages");
  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  const hourlyRateRaw = String(formData.get("hourlyRate") ?? "")
    .trim()
    .replace(",", ".");
  const validFrom = String(formData.get("validFrom") ?? "").trim();

  if (!workplaceId) return { error: "Vyber prevádzku." };
  const hourlyRate = Number(hourlyRateRaw);
  if (!hourlyRateRaw || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    return { error: "Zadaj kladnú hodinovú sadzbu." };
  }
  if (!validFrom) return { error: "Zadaj dátum platnosti." };

  const current = await withUserContext(user.id, (tx) =>
    tx
      .select()
      .from(employeeRateHistory)
      .where(
        and(
          eq(employeeRateHistory.employeeId, employeeId),
          eq(employeeRateHistory.workplaceId, workplaceId),
          isNull(employeeRateHistory.validTo),
        ),
      ),
  );

  if (current[0] && validFrom <= current[0].validFrom) {
    return { error: "Nový dátum musí byť po začiatku súčasnej sadzby." };
  }

  try {
    await withUserContext(user.id, async (tx) => {
      if (current[0]) {
        await tx
          .update(employeeRateHistory)
          .set({ validTo: validFrom })
          .where(eq(employeeRateHistory.id, current[0].id));
      }
      await tx.insert(employeeRateHistory).values({
        employeeId,
        workplaceId,
        hourlyRate: hourlyRateRaw,
        validFrom,
        createdBy: user.id,
      });
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      return { error: "Obdobia sadzieb sa prekrývajú — over dátum." };
    }
    throw err;
  }

  revalidatePath(`/zamestnanci/${employeeId}`);
  return { success: "Sadzba zmenená." };
}

// ----------------------------------------------------------------------------
// Fixný plat namiesto hodinovej sadzby, Fáza 2 — história FIX+VARIABILNEJ,
// presne rovnaký princíp ako história sadzieb vyššie (zavri starú, otvor
// novú), len BEZ prevádzky (employee_salary_history nemá workplace_id — fix
// je vlastnosť človeka, nie prevádzky). Owner ALEBO manažér s `edit_wages`
// (rovnaké zdôvodnenie ako changeRateAction — RLS salary_write, migrácia
// 0050, vynúti to isté).
// ----------------------------------------------------------------------------
export async function changeSalaryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("editWages");
  const employeeId = String(formData.get("employeeId") ?? "");
  const fixAmountRaw = String(formData.get("fixAmount") ?? "")
    .trim()
    .replace(",", ".");
  const variableAmountRaw = String(formData.get("variableAmount") ?? "0")
    .trim()
    .replace(",", ".") || "0";
  const validFrom = String(formData.get("validFrom") ?? "").trim();

  const fixAmount = Number(fixAmountRaw);
  if (!fixAmountRaw || !Number.isFinite(fixAmount) || fixAmount < 0) {
    return { error: "Zadaj nezápornú sumu fixu." };
  }
  const variableAmount = Number(variableAmountRaw);
  if (!Number.isFinite(variableAmount) || variableAmount < 0) {
    return { error: "Zadaj nezápornú sumu variabilnej zložky." };
  }
  if (!validFrom) return { error: "Zadaj dátum platnosti." };

  const current = await withUserContext(user.id, (tx) =>
    tx
      .select()
      .from(employeeSalaryHistory)
      .where(
        and(
          eq(employeeSalaryHistory.employeeId, employeeId),
          isNull(employeeSalaryHistory.validTo),
        ),
      ),
  );

  if (current[0] && validFrom <= current[0].validFrom) {
    return { error: "Nový dátum musí byť po začiatku súčasného platu." };
  }

  try {
    await withUserContext(user.id, async (tx) => {
      if (current[0]) {
        await tx
          .update(employeeSalaryHistory)
          .set({ validTo: validFrom })
          .where(eq(employeeSalaryHistory.id, current[0].id));
      }
      await tx.insert(employeeSalaryHistory).values({
        employeeId,
        fixAmount: fixAmountRaw,
        variableAmount: variableAmountRaw,
        validFrom,
        createdBy: user.id,
      });
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      return { error: "Obdobia platu sa prekrývajú — over dátum." };
    }
    throw err;
  }

  revalidatePath(`/zamestnanci/${employeeId}`);
  return { success: "Plat zmenený." };
}

// ----------------------------------------------------------------------------
// Priradenie k prevádzkam — M:N, zamestnanec môže byť vo viacerých naraz.
// ----------------------------------------------------------------------------
export async function assignWorkplaceAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  if (!workplaceId) return;

  await withUserContext(user.id, (tx) =>
    tx
      .insert(employeeWorkplaces)
      .values({ employeeId, workplaceId, isPrimary: false })
      .onConflictDoNothing(),
  );

  revalidatePath(`/zamestnanci/${employeeId}`);
}

export async function unassignWorkplaceAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");

  await withUserContext(user.id, (tx) =>
    tx
      .delete(employeeWorkplaces)
      .where(
        and(eq(employeeWorkplaces.employeeId, employeeId), eq(employeeWorkplaces.workplaceId, workplaceId)),
      ),
  );

  revalidatePath(`/zamestnanci/${employeeId}`);
}

// ----------------------------------------------------------------------------
// Pravidlá dostupnosti — najdôležitejšie UI v appke.
// ----------------------------------------------------------------------------
function buildParamsFromFormData(
  type: AvailabilityRuleType,
  formData: FormData,
): Record<string, unknown> {
  switch (RULE_TYPE_CONFIG[type].paramShape) {
    case "weekdays":
      return { days: formData.getAll("days").map(Number) };
    case "days":
      return { days: Number(formData.get("daysValue")) };
    case "parity":
      return { parity: String(formData.get("parity") ?? "") };
    case "dateRange":
      return { from: String(formData.get("from") ?? ""), to: String(formData.get("to") ?? "") };
    case "hours":
      return { hours: Number(formData.get("hoursValue")) };
    case "shiftTemplate":
      return { shift_template_id: String(formData.get("shiftTemplateId") ?? "") };
  }
}

export async function addAvailabilityRuleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const ruleType = String(formData.get("ruleType") ?? "") as AvailabilityRuleType;
  if (!(ruleType in RULE_TYPE_CONFIG)) return { error: "Neplatný typ pravidla." };

  const isHard = formData.get("isHard") === "true";
  const priority = Number(formData.get("priority") ?? 100) || 100;
  const note = String(formData.get("note") ?? "").trim() || null;
  const workplaceId = String(formData.get("workplaceId") ?? "").trim() || null;
  const validFrom = String(formData.get("validFrom") ?? "").trim() || null;
  const validTo = String(formData.get("validTo") ?? "").trim() || null;

  const params = buildParamsFromFormData(ruleType, formData);
  const check = validateRuleParams(ruleType, params);
  if (!check.valid) return { error: check.error };

  await withUserContext(user.id, (tx) =>
    tx.insert(employeeAvailabilityRules).values({
      employeeId,
      workplaceId,
      ruleType,
      params,
      isHard,
      priority,
      note,
      validFrom,
      validTo,
      createdBy: user.id,
    }),
  );

  revalidatePath(`/zamestnanci/${employeeId}`);
  return { success: "Pravidlo pridané." };
}

export async function updateAvailabilityRuleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole("owner", "manager");
  const ruleId = String(formData.get("ruleId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  const ruleType = String(formData.get("ruleType") ?? "") as AvailabilityRuleType;
  if (!(ruleType in RULE_TYPE_CONFIG)) return { error: "Neplatný typ pravidla." };

  const isHard = formData.get("isHard") === "true";
  const priority = Number(formData.get("priority") ?? 100) || 100;
  const note = String(formData.get("note") ?? "").trim() || null;
  const workplaceId = String(formData.get("workplaceId") ?? "").trim() || null;
  const validFrom = String(formData.get("validFrom") ?? "").trim() || null;
  const validTo = String(formData.get("validTo") ?? "").trim() || null;

  const params = buildParamsFromFormData(ruleType, formData);
  const check = validateRuleParams(ruleType, params);
  if (!check.valid) return { error: check.error };

  await withUserContext(user.id, (tx) =>
    tx
      .update(employeeAvailabilityRules)
      .set({ ruleType, params, isHard, priority, note, workplaceId, validFrom, validTo })
      .where(eq(employeeAvailabilityRules.id, ruleId)),
  );

  revalidatePath(`/zamestnanci/${employeeId}`);
  return { success: "Pravidlo upravené." };
}

export async function deleteAvailabilityRuleAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const ruleId = String(formData.get("ruleId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");

  await withUserContext(user.id, (tx) =>
    tx.delete(employeeAvailabilityRules).where(eq(employeeAvailabilityRules.id, ruleId)),
  );

  revalidatePath(`/zamestnanci/${employeeId}`);
}

export async function toggleAvailabilityRuleActiveAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const ruleId = String(formData.get("ruleId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  await withUserContext(user.id, (tx) =>
    tx.update(employeeAvailabilityRules).set({ isActive: nextActive }).where(eq(employeeAvailabilityRules.id, ruleId)),
  );

  revalidatePath(`/zamestnanci/${employeeId}`);
}

// ----------------------------------------------------------------------------
// Blok 15 — párovanie zamestnancov ("pracuje preferovane s X"), Stage 1:
// dátový model + UI, ZATIAĽ BEZ zapojenia do generátora (to je Stage 2/3,
// robené po častiach — "rob opatrne, po častiach", nie naraz). Nezávislé od
// pozície/prevádzky (schema.ts, migrácia 0034) — kandidát na pár je
// KTORÝKOĽVEK aktívny zamestnanec org, nielen tá istá pozícia.
// ----------------------------------------------------------------------------
function isPairingUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /duplicate key value violates unique constraint "employee_pairings_employee_a_id_employee_b_id_unique"/.test(
      String((err as { cause?: unknown }).cause ?? err.message),
    )
  );
}

export async function addPairingAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const partnerId = String(formData.get("partnerId") ?? "");
  const isHard = formData.get("isHard") === "true";
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!employeeId) return { error: "Chýba ID zamestnanca." };
  if (!partnerId) return { error: "Vyber, s kým má byť zamestnanec spárovaný." };
  if (partnerId === employeeId) return { error: "Zamestnanca nemožno spárovať so sebou samým." };

  const [employeeAId, employeeBId] = sortPairIds(employeeId, partnerId);

  try {
    await withUserContext(user.id, (tx) =>
      tx.insert(employeePairings).values({ employeeAId, employeeBId, isHard, note, createdBy: user.id }),
    );
  } catch (err) {
    if (isPairingUniqueViolation(err)) {
      return { error: "Tento pár už existuje." };
    }
    throw err;
  }

  revalidatePath(`/zamestnanci/${employeeId}`);
  revalidatePath(`/zamestnanci/${partnerId}`);
  return { success: "Pár pridaný." };
}

export async function deletePairingAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const pairingId = String(formData.get("pairingId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");

  const [deleted] = await withUserContext(user.id, (tx) =>
    tx.delete(employeePairings).where(eq(employeePairings.id, pairingId)).returning({ employeeAId: employeePairings.employeeAId, employeeBId: employeePairings.employeeBId }),
  );

  revalidatePath(`/zamestnanci/${employeeId}`);
  if (deleted) {
    revalidatePath(`/zamestnanci/${deleted.employeeAId}`);
    revalidatePath(`/zamestnanci/${deleted.employeeBId}`);
  }
}

// ----------------------------------------------------------------------------
// Blok 14, bod 3 — natrvalo zmazať zamestnanca, VRÁTANE pípnutí. Vedomé,
// dvakrát potvrdené rozhodnutie ownera — zúžená
// verzia append-only záruky punch_events. Len owner (nie manažér), rovnaký
// e-mailový kód ako ostatné mazania v Nastaveniach (lib/settings/delete-with-code.ts).
//
// Poradie je zámerné a NEATOMICKÉ na účel: krok 1 (zmazanie employees riadku,
// s cascade cez migráciu 0033 bypass) je jediná časť, ktorá SMIE zlyhať ako
// celok (FK/RLS chyba => nič sa nezmaže, transakcia sa vráti). Krok 2
// (upratanie prihlasovacieho konta) beží AŽ PO úspešnom kroku 1, v OSOBITNEJ
// transakcii — keby konto malo vlastné väzby (napr. bolo requestedBy/decidedBy
// na cudzej žiadosti), zmazanie zamestnanca sa kvôli tomu nesmie zrušiť, len
// konto namiesto zmazania DEAKTIVUJEME (rovnaký fallback ako pri config
// entitách, "namiesto mazania deaktivuj").
// ----------------------------------------------------------------------------
export async function requestDeleteEmployeeCodeAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requireRole("owner");
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return { error: "Chýba ID zamestnanca." };

  const [employee] = await withUserContext(user.id, (tx) =>
    tx.select({ firstName: employees.firstName, lastName: employees.lastName }).from(employees).where(eq(employees.id, employeeId)),
  );
  if (!employee) return { error: "Zamestnanec neexistuje." };

  await requestDeleteCode(user, "employee", employeeId, `Zamestnanec „${employee.firstName} ${employee.lastName}“ (vrátane pípnutí a histórie)`);
  return {};
}

export type DeleteEmployeeState = { error?: string };

export async function confirmDeleteEmployeeAction(_prev: DeleteEmployeeState, formData: FormData): Promise<DeleteEmployeeState> {
  const user = await requireRole("owner");
  const employeeId = String(formData.get("employeeId") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!employeeId) return { error: "Chýba ID zamestnanca." };

  const verify = await verifyDeleteCode(user, "employee", employeeId, code);
  if (!verify.ok) return { error: verify.error };

  const { linkedUserId, linkedAuthUserId } = await withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
    if (!employee) return { linkedUserId: null, linkedAuthUserId: null };

    let linkedAuthUserId: string | null = null;
    if (employee.userId) {
      const [account] = await tx.select({ authUserId: users.authUserId }).from(users).where(eq(users.id, employee.userId));
      linkedAuthUserId = account?.authUserId ?? null;
    }

    // Úzko-škálovaný bypass (migrácia 0033) — platí LEN v tejto transakcii a
    // LEN pre TOHTO zamestnanca (trigger aj RLS politiky to overujú
    // nezávisle). Nastaviť ho smie výhradne tento kód, až PO overení kódu.
    await tx.execute(sql`SELECT set_config('app.confirmed_employee_delete_id', ${employeeId}, true)`);
    await tx.delete(employees).where(eq(employees.id, employeeId));

    return { linkedUserId: employee.userId, linkedAuthUserId };
  });

  // Ak Supabase Auth zmazanie zlyhá, orphan konto BLOKUJE budúcu pozvánku na
  // ten istý email ("already been registered") — a keďže `users` riadok už
  // bude preč (fyzicky zmazaný nižšie), nezostane po ňom ŽIADNA stopa v DB
  // ani v audit logu (users dovtedy nemalo/nemá DELETE trigger). Kedysi sa
  // táto chyba tíško prehltla (`.catch(() => {})`) — presne to spôsobilo, že
  // sa orphan konto dalo nájsť len ručným pátraním cez Supabase Auth API.
  // Teraz sa zamestnanec zmaže aj tak (to je nezvratné a už potvrdené kódom),
  // ale zlyhanie sa zaloguje a ohlási ownerovi, nech vie, že treba ručne
  // dočistiť Supabase Auth pred ďalším pozvaním na ten istý email.
  let authCleanupFailed = false;
  if (linkedUserId) {
    try {
      await withUserContext(user.id, (tx) => tx.delete(users).where(eq(users.id, linkedUserId)));
      if (linkedAuthUserId) {
        const admin = createSupabaseAdminClient();
        const { error } = await admin.auth.admin.deleteUser(linkedAuthUserId);
        if (error) {
          console.error(`Zmazanie zamestnanca ${employeeId}: Supabase Auth zmazanie konta ${linkedAuthUserId} zlyhalo:`, error.message);
          authCleanupFailed = true;
        }
      }
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        // Konto má vlastné väzby inde (napr. rozhodovalo o cudzej žiadosti) —
        // zmazanie zamestnanca aj tak platí, len konto namiesto zmazania
        // deaktivujeme (blokuje prihlásenie, nič nestratí referenčnú integritu).
        await withUserContext(user.id, (tx) => tx.update(users).set({ isActive: false }).where(eq(users.id, linkedUserId)));
      } else {
        throw err;
      }
    }
  }

  revalidatePath("/zamestnanci");
  redirect(`/zamestnanci?employeeDeleted=1${authCleanupFailed ? "&authCleanupFailed=1" : ""}`);
}
