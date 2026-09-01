import { requireSettingsAccess } from "@/lib/auth/session";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default async function NastaveniaLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSettingsAccess();

  return (
    <div className="flex flex-col gap-1">
      <SettingsTabs role={user.role} permissions={user.permissions} />
      {children}
    </div>
  );
}
