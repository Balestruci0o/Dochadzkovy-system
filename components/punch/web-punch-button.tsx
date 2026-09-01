"use client";

import { Coffee, LogIn, LogOut, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type PunchKind = "zmena" | "prestavka";
type WebPunchResult = { direction: "in" | "out"; kind: PunchKind; time: string; gpsSuspicious: boolean };

type PunchState = { workplaceId: string; nextZmenaDirection: "in" | "out"; nextPrestavkaDirection: "in" | "out" | null };

/**
 * Pípnutie priamo z webu (home office). GPS je LEN soft signál:
 * ak zlyhá/zamietne sa, pípnutie sa aj tak odošle bez GPS — nikdy neblokuje.
 *
 * Smer (príchod/odchod, začiatok/koniec prestávky) NEVOLÍ zamestnanec —
 * server ho určí ROVNAKO ako pri QR termináli (`determineDirection`, podľa
 * posledného razítka toho istého dňa). Popisky tlačidiel nižšie sú len
 * PREDPOVEĎ toho istého výpočtu (spočítaná na serveri pri načítaní stránky,
 * viď `data.ts`) — nič na nej sa pri samotnom zápise nezakladá.
 */
export function WebPunchButton({
  workplaces,
  canPunchBreaks,
  punchState,
}: {
  workplaces: { workplaceId: string; workplaceName: string; isPrimary: boolean }[];
  canPunchBreaks: boolean;
  punchState: PunchState[];
}) {
  const router = useRouter();
  const [workplaceId, setWorkplaceId] = useState(
    workplaces.find((w) => w.isPrimary)?.workplaceId ?? workplaces[0]?.workplaceId ?? "",
  );
  const [pendingKind, setPendingKind] = useState<PunchKind | null>(null);
  const [result, setResult] = useState<WebPunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = punchState.find((s) => s.workplaceId === workplaceId);

  async function sendPunch(kind: PunchKind, gps: { gpsLat?: number; gpsLng?: number; gpsAccuracyM?: number }) {
    try {
      const res = await fetch("/api/punch/web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workplaceId, kind, ...gps }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Pípnutie zlyhalo.");
      } else {
        setResult(data);
        router.refresh();
      }
    } catch {
      setError("Pípnutie zlyhalo — skontroluj pripojenie.");
    } finally {
      setPendingKind(null);
    }
  }

  function handlePunch(kind: PunchKind) {
    setPendingKind(kind);
    setError(null);
    setResult(null);

    if (!("geolocation" in navigator)) {
      void sendPunch(kind, {});
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void sendPunch(kind, {
          gpsLat: pos.coords.latitude,
          gpsLng: pos.coords.longitude,
          gpsAccuracyM: pos.coords.accuracy,
        });
      },
      () => {
        // GPS zamietnuté/zlyhalo — pípnutie sa POŠLE aj tak, len bez GPS (nikdy neblokuje).
        void sendPunch(kind, {});
      },
      { timeout: 8000, maximumAge: 0 },
    );
  }

  if (workplaces.length === 0) {
    return <p className="text-sm text-ink-faint">Nie si priradený/á k žiadnej prevádzke — pípnutie z webu nie je dostupné.</p>;
  }

  const zmenaLabel = state?.nextZmenaDirection === "out" ? "Pípnuť odchod" : "Pípnuť príchod";
  const prestavkaLabel = state?.nextPrestavkaDirection === "in" ? "Skončiť prestávku" : "Začať prestávku";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      {workplaces.length > 1 && (
        <select
          value={workplaceId}
          onChange={(e) => setWorkplaceId(e.target.value)}
          className="rounded-md border border-line bg-paper px-3 py-2.5 text-sm text-ink"
        >
          {workplaces.map((w) => (
            <option key={w.workplaceId} value={w.workplaceId}>
              {w.workplaceName}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => handlePunch("zmena")}
        disabled={pendingKind !== null}
        className="flex items-center gap-2 rounded-md bg-orange px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {state?.nextZmenaDirection === "out" ? <LogOut size={16} /> : <LogIn size={16} />}
        {pendingKind === "zmena" ? "Pípam…" : zmenaLabel}
      </button>
      {canPunchBreaks && (
        <button
          type="button"
          onClick={() => handlePunch("prestavka")}
          disabled={pendingKind !== null}
          className="flex items-center gap-2 rounded-md border border-line bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-cream-2 disabled:opacity-60"
        >
          <Coffee size={16} />
          {pendingKind === "prestavka" ? "Pípam…" : prestavkaLabel}
        </button>
      )}
      {result && (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-sage-dark">
          {result.direction === "in" ? <LogIn size={15} /> : <LogOut size={15} />}
          {result.kind === "prestavka"
            ? result.direction === "out"
              ? "Prestávka začatá"
              : "Prestávka skončená"
            : result.direction === "in"
              ? "Príchod zaznamenaný"
              : "Odchod zaznamenaný"}{" "}
          o {result.time}
          {result.gpsSuspicious && (
            <span className="flex items-center gap-1 text-late" title="GPS mimo okruhu prevádzky — len na vedomie, nič to nezablokovalo">
              <MapPin size={13} /> mimo okruhu
            </span>
          )}
        </span>
      )}
      {error && <span className="text-sm text-late">{error}</span>}
    </div>
  );
}
