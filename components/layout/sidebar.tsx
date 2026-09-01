"use client";

import { Bell, LogOut, Phone } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/(auth)/odhlasenie/actions";
import type { ManagerPermissions } from "@/lib/auth/manager-permissions";
import type { UserRole } from "@/lib/auth/session";
import { Avatar } from "@/components/avatar";
import { BrandLogo } from "@/components/brand-logo";
import { brand } from "@/lib/branding/config";
import { getNavForRole, getSidebarSectionLabel, ROLE_LABELS } from "./nav-config";

type SidebarUser = {
  fullName: string;
  role: UserRole;
  permissions: ManagerPermissions;
};

export function Sidebar({
  user,
  open,
  onClose,
}: {
  user: SidebarUser;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const nav = getNavForRole(user.role, user.permissions);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[55] bg-ink/40 backdrop-blur-[2px] max-[900px]:block hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`z-[60] flex h-screen w-[264px] flex-none flex-col border-r border-line bg-paper
          max-[900px]:fixed max-[900px]:left-0 max-[900px]:top-0 max-[900px]:w-[280px] max-[900px]:max-w-[84vw]
          max-[900px]:shadow-none max-[900px]:transition-transform max-[900px]:duration-[260ms]
          ${open ? "max-[900px]:translate-x-0 max-[900px]:shadow-2xl" : "max-[900px]:-translate-x-full"}
          min-[901px]:sticky min-[901px]:top-0`}
      >
        <div className="flex items-center gap-3 px-6 pb-[18px] pt-[26px]">
          <BrandLogo size={50} className="text-ink" />
          <div className="flex flex-col leading-tight">
            <b className="font-serif text-lg font-bold tracking-tight text-ink">{brand.appName}</b>
            {brand.tagline && (
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
                {brand.tagline}
              </span>
            )}
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3.5 py-2">
          <div className="px-2.5 pb-[7px] pt-[18px] text-[10.5px] font-bold uppercase tracking-[0.13em] text-ink-faint">
            {getSidebarSectionLabel(user.role)}
          </div>
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                // PÔVODNE prefetch={true} (Blok 3) — natiahlo to celý obsah
                // KAŽDEJ položky v sidebari pri každom vykreslení, lebo v appke
                // vtedy neexistoval jediný loading.tsx (dynamické stránky bez
                // loading hranice sa pri prefetchi natiahnu naplno, nie len
                // skelet). Namerané: až 15 middleware getUser() volaní na jeden
                // klik (výkonová diagnostika). Teraz loading.tsx dáva
                // kliku okamžitú vizuálnu odozvu aj bez prefetchu — vypnuté.
                prefetch={false}
                className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14.5px] font-medium transition-colors
                  ${active ? "bg-sage-tint font-semibold text-sage-dark" : "text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
              >
                <item.icon size={19} strokeWidth={1.7} className="flex-none" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3.5">
          <div className="flex items-center gap-[11px] px-2 pb-1 pt-2.5">
            <Avatar name={user.fullName} size={38} />
            <div className="min-w-0 leading-tight">
              <b className="block truncate text-sm font-semibold text-ink">{user.fullName}</b>
              <span className="text-xs text-ink-faint">{ROLE_LABELS[user.role]}</span>
            </div>
          </div>
          {/* Prístupné VŠETKÝM rolám — preto tu, nie v `nav-config.ts` (ten sa
              líši per rola). "Upozornenia" = notification_preferences UI
              (Blok 13, bod 4), "Kontakt" = podpora/majiteľ/manažér (bod 6). */}
          <Link
            href="/moje-upozornenia"
            onClick={onClose}
            prefetch={false}
            className="mt-1 flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-cream-2 hover:text-ink"
          >
            <Bell size={17} strokeWidth={1.8} />
            Upozornenia
          </Link>
          <Link
            href="/kontakt"
            onClick={onClose}
            prefetch={false}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-cream-2 hover:text-ink"
          >
            <Phone size={17} strokeWidth={1.8} />
            Kontakt
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="mt-1 flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-cream-2 hover:text-ink"
            >
              <LogOut size={17} strokeWidth={1.8} />
              Odhlásiť sa
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
