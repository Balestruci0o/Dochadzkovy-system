import { requireRole } from "@/lib/auth/session";
import { InviteForm } from "./invite-form";

export default async function PozvatPage() {
  const user = await requireRole("owner", "manager");

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-paper p-8 shadow-sm">
        <h1 className="font-serif text-2xl font-bold text-ink">Pozvať používateľa</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          Pošleme mu email s odkazom na nastavenie hesla.
        </p>
        <InviteForm canInviteManagers={user.role === "owner"} />
      </div>
    </div>
  );
}
