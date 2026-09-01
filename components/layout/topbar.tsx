"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import type { MyNotifications } from "@/app/(app)/notifications/actions";
import { NotificationBell } from "./notification-bell";
import { getPageTitle } from "./page-titles";

export function Topbar({ onOpenMenu, notifications }: { onOpenMenu: () => void; notifications: MyNotifications }) {
  const pathname = usePathname();
  const [title, sub] = getPageTitle(pathname);

  return (
    <header
      className="sticky top-0 z-20 flex h-[74px] flex-none items-center gap-[18px] border-b border-line
        bg-cream/86 px-[34px] backdrop-blur-[8px]
        max-[900px]:h-16 max-[900px]:gap-3 max-[900px]:px-[18px]"
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Otvoriť menu"
        className="-ml-1.5 hidden h-[42px] w-[42px] flex-none items-center justify-center rounded-[10px]
          text-ink transition-colors hover:bg-cream-2 max-[900px]:flex"
      >
        <Menu size={22} strokeWidth={2} />
      </button>
      <div className="min-w-0 flex-none max-[900px]:min-w-0 max-[900px]:flex-1">
        <h1 className="whitespace-nowrap font-serif text-[25px] font-bold leading-tight tracking-tight text-ink max-[900px]:truncate max-[900px]:text-[21px]">
          {title}
        </h1>
        {sub && (
          <div className="mt-0.5 text-[13.5px] text-ink-soft max-[900px]:text-[12.5px]">{sub}</div>
        )}
      </div>
      <div className="flex-1" />
      <NotificationBell initial={notifications} />
    </header>
  );
}
