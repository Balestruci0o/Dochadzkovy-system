import { CorrectionReviewList } from "@/components/punch/correction-review-list";
import { MissingPunchReviewList } from "@/components/punch/missing-punch-review-list";
import { OnBreakNowCard } from "@/components/punch/on-break-now";
import { requireRole } from "@/lib/auth/session";
import { getOnBreakNow, getPendingCorrections, getPendingMissingPunchRequests } from "./data";

export default async function DnesPage() {
  const user = await requireRole("owner", "manager");
  const [corrections, missingPunches, onBreak] = await Promise.all([
    getPendingCorrections(user),
    getPendingMissingPunchRequests(user),
    getOnBreakNow(user),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <OnBreakNowCard initial={onBreak} />
      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <h3 className="mb-3 font-serif text-lg font-bold text-ink">Žiadosti o opravu razítka</h3>
        <CorrectionReviewList corrections={corrections} />
      </div>
      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <h3 className="mb-3 font-serif text-lg font-bold text-ink">Žiadosti o chýbajúce pípnutie</h3>
        <MissingPunchReviewList requests={missingPunches} />
      </div>
    </div>
  );
}
