"use client";

import { Coffee } from "lucide-react";
import { useEffect, useState } from "react";
import { getOnBreakNowAction } from "@/app/(app)/dnes/actions";
import type { OnBreakNow } from "@/app/(app)/dnes/data";
import { fmtTime } from "./attendance-status";

const POLL_INTERVAL_MS = 20_000;

function minutesSince(d: Date): number {
  return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60_000));
}

/** Blok "kto je práve teraz na prestávke" — polluje ako `NotificationBell` (rovnaký vzor), nie WebSocket. */
export function OnBreakNowCard({ initial }: { initial: OnBreakNow[] }) {
  const [rows, setRows] = useState(initial);

  useEffect(() => {
    const interval = setInterval(() => {
      getOnBreakNowAction().then(setRows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-ink">
        <Coffee size={18} className="text-orange" /> Na prestávke práve teraz
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint">Momentálne nikto nie je na prestávke.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.employeeId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-cream px-3.5 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 flex-none rounded-full bg-orange" />
                <b className="text-sm text-ink">{r.employeeName}</b>
                <span className="text-xs text-ink-faint">{r.workplaceName}</span>
              </div>
              <span className="text-sm text-ink-soft">
                od {fmtTime(r.breakStartedAt)} · {minutesSince(r.breakStartedAt)} min
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
