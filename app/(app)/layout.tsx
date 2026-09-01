import { getMyNotifications } from "./notifications/actions";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const notifications = await getMyNotifications();

  return (
    <AppShell user={{ fullName: user.fullName, role: user.role, permissions: user.permissions }} notifications={notifications}>
      {children}
    </AppShell>
  );
}
