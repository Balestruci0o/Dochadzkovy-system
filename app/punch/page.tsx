import { and, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QrPunchScreen } from "@/components/punch/qr-punch-screen";
import { requireUser } from "@/lib/auth/session";
import { brandMeta } from "@/lib/branding/config";
import { withUserContext } from "@/lib/db";
import { employeePositionHistory, employees, positions } from "@/lib/db/schema";
import { resolveBreakTrackingMode } from "@/lib/scheduler/break-tracking-mode";

export const metadata: Metadata = {
  title: brandMeta.punchTitle,
};

export default async function PunchPage() {
  const user = await requireUser();

  const employee = await withUserContext(user.id, async (tx) => {
    const [row] = await tx.select().from(employees).where(eq(employees.userId, user.id));
    if (!row) return null;

    const [currentPosition] = await tx
      .select({ breakTrackingMode: positions.breakTrackingMode })
      .from(employeePositionHistory)
      .innerJoin(positions, eq(positions.id, employeePositionHistory.positionId))
      .where(and(eq(employeePositionHistory.employeeId, row.id), isNull(employeePositionHistory.validTo)));

    return { row, currentPosition: currentPosition ?? null };
  });

  if (!employee) redirect("/");

  // Pípanie prestávok, krok 3 — druhý QR kód (Prestávka) sa zobrazí len
  // zamestnancom v režime "pípa" (lib/scheduler/break-tracking-mode.ts,
  // rovnaký vzor ako work_time_mode). V "automaticky" by druhý QR kód nemal
  // zmysel — hodiny sa vždy počítajú zo šablóny, nie z reálnych razítok.
  const breakTrackingMode = resolveBreakTrackingMode(employee.currentPosition, {
    overrideBreakTrackingMode: employee.row.overrideBreakTrackingMode,
  });

  return (
    <QrPunchScreen
      employeeName={`${employee.row.firstName} ${employee.row.lastName}`}
      canPunchBreaks={breakTrackingMode === "pipa"}
    />
  );
}
