import { notFound } from "next/navigation";
import { MyAbsenceRequestForm } from "@/components/absences/my-absence-request-form";
import { MyAbsenceRequestList } from "@/components/absences/my-absence-request-list";
import { requireRole } from "@/lib/auth/session";
import { getMyAbsenceRequests } from "./data";

export default async function MojeZiadostiPage() {
  const user = await requireRole("employee");
  const requests = await getMyAbsenceRequests(user);
  if (!requests) notFound();

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <h3 className="mb-3 font-serif text-lg font-bold text-ink">Nová žiadosť</h3>
        <MyAbsenceRequestForm />
      </div>

      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <h3 className="mb-3 font-serif text-lg font-bold text-ink">Moje žiadosti</h3>
        <MyAbsenceRequestList requests={requests} />
      </div>
    </div>
  );
}
