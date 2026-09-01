import { notFound } from "next/navigation";
import { AttendanceList } from "@/components/punch/attendance-list";
import { MissingPunchCard } from "@/components/punch/missing-punch-form";
import { WebPunchButton } from "@/components/punch/web-punch-button";
import { requireRole } from "@/lib/auth/session";
import { getMyAttendance } from "./data";

export default async function MojaDochadzkaPage() {
  const user = await requireRole("employee");
  const data = await getMyAttendance(user);
  if (!data) notFound();

  return (
    <div className="flex flex-col gap-5">
      {data.canPunchWeb && (
        <WebPunchButton workplaces={data.workplaces} canPunchBreaks={data.canPunchBreaks} punchState={data.punchState} />
      )}
      <MissingPunchCard workplaces={data.workplaces} requests={data.missingPunchRequests} />
      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <h3 className="mb-3 font-serif text-lg font-bold text-ink">Posledných 30 dní</h3>
        <AttendanceList days={data.days} requests={data.requests} />
      </div>
    </div>
  );
}
