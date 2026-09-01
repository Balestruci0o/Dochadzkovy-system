import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityRulesSection } from "@/components/employees/availability-rules-section";
import { EmployeeHero } from "@/components/employees/employee-hero";
import { PairingsSection } from "@/components/employees/pairings-section";
import { PositionHistorySection } from "@/components/employees/position-history-section";
import { RateHistorySection } from "@/components/employees/rate-history-section";
import { SalaryHistorySection } from "@/components/employees/salary-history-section";
import { WorkplacesSection } from "@/components/employees/workplaces-section";
import { hasManagerPermission } from "@/lib/auth/manager-permissions";
import { requireRole } from "@/lib/auth/session";
import { resolvePayMode } from "@/lib/payroll/resolve-pay-mode";
import { getEmployeeDeletionSummary, getEmployeeDetail, getEmployeePairings, getPairingCandidates } from "./data";

export default async function ZamestnanecDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ accountError?: string; accountSuccess?: string }>;
}) {
  const user = await requireRole("owner", "manager");
  const { id } = await params;
  const { accountError, accountSuccess } = await searchParams;

  const detail = await getEmployeeDetail(user, id);
  if (!detail) notFound();

  const canEdit = user.role === "owner" || user.role === "manager";
  const isOwner = user.role === "owner";
  // Fáza 4 (Mzdy) — history sekcie majú TERAZ vlastnú, užšiu pravomoc
  // (edit_wages), nezávislú od "isOwner" — manažér s balíčkom smie meniť
  // sadzby/plat, aj keď isOwner=false.
  const canEditWages = hasManagerPermission(user.role, user.permissions, "editWages");
  // Fixný plat, Fáza 2 — default žije na POZÍCII, zamestnanec ho smie
  // prepísať (presne vzor resolveBreakTrackingMode). Rozhoduje, či sa v
  // gride nižšie zobrazí história hodinovej sadzby alebo fixného platu —
  // NIKDY oba naraz, nech sa fixnému nezobrazuje irelevantná sadzba a naopak.
  const resolvedPayMode = resolvePayMode(
    detail.currentPosition ? { payMode: detail.currentPosition.positionPayMode } : null,
    { overridePayMode: detail.employee.overridePayMode },
  );
  const [deletionSummary, pairings, pairingCandidates] = await Promise.all([
    isOwner ? getEmployeeDeletionSummary(user, id) : Promise.resolve(null),
    getEmployeePairings(user, id),
    getPairingCandidates(user, id),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/zamestnanci"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
      >
        <ArrowLeft size={16} /> Späť na zoznam
      </Link>

      {accountError && (
        <p className="rounded-md border border-late/40 bg-late-tint px-4 py-3 text-sm text-late">{accountError}</p>
      )}
      {accountSuccess && (
        <p className="rounded-md border border-ok/40 bg-ok-tint px-4 py-3 text-sm text-ok">Hotovo — pozvánka bola odoslaná.</p>
      )}

      <EmployeeHero
        employee={detail.employee}
        positionName={detail.currentPosition?.positionName ?? null}
        positionColor={detail.currentPosition?.positionColor ?? null}
        canEdit={canEdit}
        account={detail.account}
        isOwner={isOwner}
        deletionSummary={
          deletionSummary ?? {
            punchEventsCount: 0,
            absenceRequestsCount: 0,
            attendanceDaysCount: 0,
            scheduledShiftsCount: 0,
            positionHistoryCount: 0,
            rateHistoryCount: 0,
          }
        }
      />

      <AvailabilityRulesSection
        employeeId={detail.employee.id}
        rules={detail.availabilityRules}
        workplaceOptions={detail.allWorkplaces}
        shiftTemplateOptions={detail.shiftTemplateOptions}
        canEdit={canEdit}
      />

      <PairingsSection
        employeeId={detail.employee.id}
        pairings={pairings}
        candidates={pairingCandidates}
        canEdit={canEdit}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <PositionHistorySection
          employeeId={detail.employee.id}
          history={detail.positionHistory}
          positionOptions={detail.allPositions}
          canEdit={canEdit}
        />
        {resolvedPayMode === "fixny" ? (
          <SalaryHistorySection
            employeeId={detail.employee.id}
            history={detail.salaryHistory}
            canEdit={canEditWages}
          />
        ) : (
          <RateHistorySection
            employeeId={detail.employee.id}
            history={detail.rateHistory}
            workplaceOptions={detail.employeeWorkplaces.map((w) => ({ id: w.workplaceId, name: w.workplaceName }))}
            canEdit={canEditWages}
          />
        )}
      </div>

      <WorkplacesSection
        employeeId={detail.employee.id}
        assigned={detail.employeeWorkplaces}
        allWorkplaces={detail.allWorkplaces}
        canEdit={canEdit}
      />
    </div>
  );
}
