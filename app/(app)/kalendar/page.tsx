import { TeamCalendar } from "@/components/calendar/team-calendar";
import { requireRole } from "@/lib/auth/session";
import { getCalendarData } from "./data";

export default async function KalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ workplace?: string; y?: string; m?: string }>;
}) {
  const user = await requireRole("owner", "manager");
  const { workplace, y, m } = await searchParams;

  const now = new Date();
  const year = Number(y) || now.getFullYear();
  const month = Number(m) && Number(m) >= 1 && Number(m) <= 12 ? Number(m) : now.getMonth() + 1;

  const data = await getCalendarData(user, workplace, year, month);

  return <TeamCalendar data={data} year={year} month={month} />;
}
