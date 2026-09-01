import { redirect } from "next/navigation";
import { hasManagerPermission } from "@/lib/auth/manager-permissions";
import { requireSettingsAccess } from "@/lib/auth/session";
import { SETTINGS_TABS } from "@/lib/settings/settings-nav";

/**
 * Holý index `/nastavenia` — presmeruje na PRVÚ podstránku, na ktorú má
 * prihlásený skutočne prístup. PREDTÝM tu bol hardcoded `redirect("/nastavenia/prevadzky")`
 * (owner-only, mimo systému pravomocí) — pre povoleného manažéra to
 * znamenalo tichý odskok cez prevadzky/page.tsx vlastný requireRole("owner")
 * až späť na "/" → "/dnes", aj keď mal reálny prístup napr. na Pozície.
 * Objavené naživo (Fáza 2 overenie), nie v testoch — SETTINGS_TABS je teraz
 * zdieľaný zoznam s `SettingsTabs`, aby sa toto nemohlo rozísť znova.
 */
export default async function NastaveniaPage() {
  const user = await requireSettingsAccess();

  const firstAccessible = SETTINGS_TABS.find((tab) =>
    tab.permission ? hasManagerPermission(user.role, user.permissions, tab.permission) : user.role === "owner",
  );
  redirect(firstAccessible?.href ?? "/");
}
