import { AbsenceOnBehalfForm } from "@/components/absences/absence-on-behalf-form";
import { AbsenceReviewList } from "@/components/absences/absence-review-list";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeOptionsForManager, getPendingAbsenceRequests } from "./data";

export default async function ZiadostiPage() {
  const user = await requireRole("owner", "manager");
  const [requests, employees] = await Promise.all([getPendingAbsenceRequests(user), getEmployeeOptionsForManager(user)]);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold text-ink">Žiadosti čakajúce na schválenie</h3>
        </div>
        <AbsenceReviewList requests={requests} />
      </div>

      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <h3 className="mb-3 font-serif text-lg font-bold text-ink">Zadať žiadosť za zamestnanca</h3>
        <AbsenceOnBehalfForm employees={employees} />
      </div>
    </div>
  );
}
