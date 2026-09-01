"use client";

import { useEffect, useState } from "react";
import type { MyNotifications } from "@/app/(app)/notifications/actions";
import type { ManagerPermissions } from "@/lib/auth/manager-permissions";
import type { UserRole } from "@/lib/auth/session";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  user,
  notifications,
  children,
}: {
  user: { fullName: string; role: UserRole; permissions: ManagerPermissions };
  notifications: MyNotifications;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Zamkni scroll pozadia, kým je mobilný drawer otvorený.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen bg-cream max-[900px]:block">
      <Sidebar user={user} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col max-[900px]:min-h-screen">
        <Topbar onOpenMenu={() => setDrawerOpen(true)} notifications={notifications} />
        <div className="w-full max-w-[1180px] px-[34px] py-[30px] pb-[60px] max-[1024px]:px-[26px] max-[1024px]:pb-[56px] max-[1024px]:pt-[28px] max-[900px]:px-[18px] max-[900px]:pb-[54px] max-[900px]:pt-[22px] max-[1180px]:max-w-none">
          {children}
        </div>
      </main>
    </div>
  );
}
