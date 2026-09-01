"use client";

import { Bell, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  getMyNotifications,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type MyNotifications,
  type NotificationItem,
} from "@/app/(app)/notifications/actions";

const POLL_INTERVAL_MS = 20_000;

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "práve teraz";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `pred ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `pred ${hours} h`;
  const days = Math.floor(hours / 24);
  return `pred ${days} d`;
}

function fullDateTime(date: Date): string {
  return new Date(date).toLocaleString("sk-SK", { dateStyle: "long", timeStyle: "short" });
}

/**
 * Blok 13, bod 5 — klik na notifikáciu predtým VŽDY hneď presmeroval preč
 * (celý riadok bol `<Link>`), takže si ju nešlo poriadne prečítať skôr, než
 * appka odnavigovala. Teraz klik na riadok len ROZBALÍ detail (presný čas
 * namiesto "pred X min") — samotné presmerovanie je samostatné tlačidlo
 * "Otvoriť", ktoré sa objaví až v rozbalenom stave.
 */
export function NotificationBell({ initial }: { initial: MyNotifications }) {
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      getMyNotifications().then(setData);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    getMyNotifications().then(setData);

    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setExpandedId(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function markOneRead(id: string) {
    const fd = new FormData();
    fd.set("notificationId", id);
    await markNotificationReadAction(fd);
    setData((prev) => ({
      unreadCount: Math.max(0, prev.unreadCount - 1),
      items: prev.items.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n)),
    }));
  }

  async function markAllRead() {
    await markAllNotificationsReadAction();
    setData((prev) => ({ unreadCount: 0, items: prev.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })) }));
  }

  function toggleExpand(n: NotificationItem) {
    if (expandedId === n.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(n.id);
    if (!n.readAt) markOneRead(n.id);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifikácie"
        className="relative flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-cream-2"
      >
        <Bell size={20} strokeWidth={2} />
        {data.unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-late px-1 text-[10px] font-bold leading-none text-white">
            {data.unreadCount > 9 ? "9+" : data.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-[420px] w-[360px] max-[420px]:w-[calc(100vw-36px)] overflow-y-auto rounded-[12px] border border-line bg-paper shadow-lg">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
            <b className="text-sm text-ink">Notifikácie</b>
            {data.unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-semibold text-orange hover:underline">
                Označiť všetko ako prečítané
              </button>
            )}
          </div>

          {data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">Zatiaľ žiadne notifikácie.</p>
          ) : (
            <div className="flex flex-col">
              {data.items.map((n) => {
                const isExpanded = expandedId === n.id;
                return (
                  <div key={n.id} className={`border-b border-line-soft last:border-b-0 ${!n.readAt ? "bg-orange-tint/40" : ""}`}>
                    <button type="button" onClick={() => toggleExpand(n)} className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left">
                      <div className="flex items-start justify-between gap-2">
                        <b className="text-[13px] leading-snug text-ink">{n.title}</b>
                        {!n.readAt && <span className="mt-1 h-2 w-2 flex-none rounded-full bg-orange" />}
                      </div>
                      {n.body && <p className="text-[12.5px] text-ink-soft">{n.body}</p>}
                      <span className="text-[11px] text-ink-faint">{isExpanded ? fullDateTime(n.createdAt) : timeAgo(n.createdAt)}</span>
                    </button>
                    {isExpanded && n.link && (
                      <div className="px-4 pb-3">
                        <Link
                          href={n.link}
                          onClick={() => setOpen(false)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-orange px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-dark"
                        >
                          <ExternalLink size={13} /> Otvoriť
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
