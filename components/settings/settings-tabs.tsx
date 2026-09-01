"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasManagerPermission, type ManagerPermissions } from "@/lib/auth/manager-permissions";
import type { UserRole } from "@/lib/auth/session";
import { SETTINGS_TABS } from "@/lib/settings/settings-nav";

export function SettingsTabs({ role, permissions }: { role: UserRole; permissions: ManagerPermissions }) {
  const pathname = usePathname();
  const visibleTabs = SETTINGS_TABS.filter((tab) => (tab.permission ? hasManagerPermission(role, permissions, tab.permission) : role === "owner"));

  return (
    <div className="relative -mx-1 mb-5">
      {/* Náznak, že sa dá scrollovať doprava — na úzkom displeji je vidieť len
          2-3 z 8 tabov a nič to nenaznačuje bez tejto rady. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-cream to-transparent max-[640px]:block hidden" />
      <div className="flex gap-1 overflow-x-auto border-b border-line px-1 pb-px">
        {visibleTabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            // Bez tohto by default prefetch (viditeľnosť vo viewporte) natiahol
            // VŠETKÝCH 8 tabov naraz pri každom vstupe do Nastavení — každý s
            // vlastným middleware auth-check a časť aj s reálnymi DB dotazmi.
            // loading.tsx v tomto segmente dá klik na tab okamžitú spätnú väzbu
            // aj bez prefetchu.
            prefetch={false}
            className={`flex-none whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              active
                ? "border-orange text-orange"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
        })}
      </div>
    </div>
  );
}
