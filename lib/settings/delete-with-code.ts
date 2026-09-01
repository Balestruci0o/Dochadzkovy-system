import { headers } from "next/headers";
import type { CurrentUser } from "@/lib/auth/session";
import { sendDestructiveActionCode, verifyDestructiveActionCode, type DestructiveActionTargetType } from "@/lib/auth/destructive-action";
import { getClientIp } from "@/lib/shared/client-ip";

/**
 * Blok 14 — tenká vrstva nad `lib/auth/destructive-action.ts` špecifická pre
 * mazanie z Nastavení: dopĺňa IP (z requestu) a e-mail/meno potvrdzujúceho
 * (vždy owner sám sebe — "step-up" overenie, nie inému príjemcovi).
 */
export async function requestDeleteCode(
  user: CurrentUser,
  targetType: DestructiveActionTargetType,
  targetId: string,
  actionLabel: string,
): Promise<void> {
  await sendDestructiveActionCode({
    userId: user.id,
    targetType,
    targetId,
    email: user.email,
    fullName: user.fullName,
    actionLabel,
  });
}

export async function verifyDeleteCode(
  user: CurrentUser,
  targetType: DestructiveActionTargetType,
  targetId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const h = await headers();
  const ip = getClientIp(h);
  return verifyDestructiveActionCode({ userId: user.id, targetType, targetId, code, ip });
}

/**
 * Postgres FK constraint bez ON DELETE cascade/set null (napr.
 * `employee_position_history.position_id`, `scheduled_shifts.shift_template_id`)
 * hodí presne túto chybu, keď na riadok niečo odkazuje — rovnaký vzor
 * detekcie ako `isUniqueViolation` v `lib/auth/invite-employee.ts`.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /violates foreign key constraint/.test(String((err as { cause?: unknown }).cause ?? err.message))
  );
}
