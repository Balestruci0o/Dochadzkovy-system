import { desc } from "drizzle-orm";
import { HolidayList } from "@/components/settings/holiday-list";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { holidays } from "@/lib/db/schema";

export default async function SviatkyPage() {
  const user = await requireRole("owner");

  const rows = await withUserContext(user.id, (tx) => tx.select().from(holidays).orderBy(desc(holidays.date)));

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <HolidayList holidays={rows} />
    </div>
  );
}
