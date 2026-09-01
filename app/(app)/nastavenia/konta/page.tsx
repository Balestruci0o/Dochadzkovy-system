import { AccountList } from "@/components/settings/account-list";
import { requirePermission } from "@/lib/auth/session";
import { getKontaData } from "./data";

export default async function KontaPage() {
  const user = await requirePermission("manageAccounts");
  const data = await getKontaData(user);

  return <AccountList data={data} currentUserId={user.id} isOwner={user.role === "owner"} />;
}
