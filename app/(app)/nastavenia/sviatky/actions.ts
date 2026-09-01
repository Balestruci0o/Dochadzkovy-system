"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { getSkHolidaysForYear } from "@/lib/shared/sk-holidays";

export type ActionState = { error?: string; success?: boolean; imported?: number };

export async function createHolidayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner");

  const date = String(formData.get("date") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!date) return { error: "Vyplň dátum." };
  if (!name) return { error: "Vyplň názov sviatku." };

  await withUserContext(user.id, (tx) =>
    tx.insert(holidays).values({ date, name }).onConflictDoUpdate({ target: holidays.date, set: { name } }),
  );

  revalidatePath("/nastavenia/sviatky");
  return { success: true };
}

export async function deleteHolidayAction(formData: FormData) {
  const user = await requireRole("owner");
  const date = String(formData.get("date") ?? "");

  await withUserContext(user.id, (tx) => tx.delete(holidays).where(eq(holidays.date, date)));

  revalidatePath("/nastavenia/sviatky");
}

export async function importSkHolidaysAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner");
  const year = Number(formData.get("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Neplatný rok." };

  const rows = getSkHolidaysForYear(year).map((h) => ({ ...h, country: "SK" }));

  await withUserContext(user.id, (tx) =>
    tx.insert(holidays).values(rows).onConflictDoNothing({ target: holidays.date }),
  );

  revalidatePath("/nastavenia/sviatky");
  return { success: true, imported: rows.length };
}
