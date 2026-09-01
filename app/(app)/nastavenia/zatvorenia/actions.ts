"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { workplaceClosures } from "@/lib/db/schema";
import { addDays } from "@/lib/shared/dates";

export type ActionState = { error?: string; success?: boolean; message?: string };

// Bezpečnostný strop na omylom zadaný interval (napr. rokmi obrátené dátumy) —
// `workplace_closures` je jeden riadok na deň, nie rozsah, takže interval sa
// vždy rozbaľuje na jednotlivé dni pri zápise.
const MAX_CLOSURE_RANGE_DAYS = 366;

export async function createClosureAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageRules");

  const workplaceId = String(formData.get("workplaceId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const dateTo = String(formData.get("dateTo") ?? "").trim() || date;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!workplaceId) return { error: "Vyber prevádzku." };
  if (!date) return { error: "Vyplň dátum." };
  if (dateTo < date) return { error: "Dátum „do“ nemôže byť skôr než dátum „od“." };

  const dates: string[] = [];
  for (let d = date; d <= dateTo; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > MAX_CLOSURE_RANGE_DAYS) {
      return { error: `Interval je príliš dlhý (max. ${MAX_CLOSURE_RANGE_DAYS} dní) — over si dátumy.` };
    }
  }

  const inserted = await withUserContext(user.id, (tx) =>
    tx
      .insert(workplaceClosures)
      .values(dates.map((d) => ({ workplaceId, date: d, reason, createdBy: user.id })))
      .onConflictDoNothing({ target: [workplaceClosures.workplaceId, workplaceClosures.date] })
      .returning({ date: workplaceClosures.date }),
  );

  revalidatePath("/nastavenia/zatvorenia");

  const skipped = dates.length - inserted.length;
  if (dates.length === 1) {
    if (inserted.length === 0) return { error: "Pre tento dátum a prevádzku už zatvorenie existuje." };
    return { success: true };
  }
  return {
    success: true,
    message:
      skipped > 0
        ? `Pridaných ${inserted.length} dní, ${skipped} už zatvorenie malo (preskočené).`
        : `Pridaných ${inserted.length} dní.`,
  };
}

export async function deleteClosureAction(formData: FormData) {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");

  await withUserContext(user.id, (tx) => tx.delete(workplaceClosures).where(eq(workplaceClosures.id, id)));

  revalidatePath("/nastavenia/zatvorenia");
}
