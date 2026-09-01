"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { brand } from "@/lib/branding/config";

// Obnov o toľko skôr, než token SKUTOČNE vyprší (server hovorí presne kedy
// cez `expiresAt`) — nie pevný 25s interval počítaný od klienta. Rozdiel je
// dôležitý: mobilný prehliadač/PWA vie na pozadí "zaspať" (obrazovka sa
// uzamkne, OS uspí kartu) a naplánovaný `setTimeout` sa oneskorí alebo
// zmešká svoj čas úplne — server-authoritative `expiresAt` + okamžitý
// refresh pri návrate viditeľnosti (nižšie) opravujú presne toto: nezáleží,
// AKO dlho bola obrazovka mimo, ďalší refresh sa vždy spočíta odznova.
const REFRESH_BUFFER_MS = 5_000;
const ERROR_RETRY_MS = 5_000;

type FetchState = "loading" | "ok" | "error";
type PunchKind = "zmena" | "prestavka";

/** `canPunchBreaks` — pípanie prestávok, krok 3: druhá záložka (Prestávka) sa
 * zobrazí len zamestnancom v režime "pípa" (viď app/punch/page.tsx). */
export function QrPunchScreen({ employeeName, canPunchBreaks }: { employeeName: string; canPunchBreaks: boolean }) {
  const [kind, setKind] = useState<PunchKind>("zmena");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [state, setState] = useState<FetchState>("loading");
  // null (nie new Date()) — server a prvý klientský render musia vykresliť
  // ÚPLNE rovnaký text, inak React nahlási hydration mismatch (čas sa medzi
  // serverovým a klientským renderom nevyhnutne posunie o pár sekúnd).
  // Skutočný čas sa doplní až v useEffect, ktorý beží len na klientovi.
  const [now, setNow] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Aktuálny `kind` v ref — `refresh` má stabilnú identitu (prázdne deps),
  // takže potrebuje spôsob, ako zistiť "je tento prebiehajúci beh ešte
  // aktuálny?" bez toho, aby sa musel znova vytvárať pri každom prepnutí
  // záložky (Príchod/odchod ↔ Prestávka).
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const refresh = useCallback(async (activeKind: PunchKind) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      const res = await fetch(`/api/qr-token?kind=${activeKind}`, { cache: "no-store" });
      if (!res.ok) throw new Error("request failed");
      const body = (await res.json()) as { token: string; expiresAt: string };
      const url = await QRCode.toDataURL(body.token, {
        width: 512,
        margin: 1,
        color: { dark: "#1c1b19", light: "#faf8f3" },
      });
      // Medzitým sa mohla prepnúť záložka (Zmena/Prestávka) — tento výsledok
      // patrí starému výberu, zahoď ho, nech neprepíše novší beh.
      if (kindRef.current !== activeKind) return;
      setDataUrl(url);
      setState("ok");
      const msUntilExpiry = new Date(body.expiresAt).getTime() - Date.now();
      timerRef.current = setTimeout(() => refresh(activeKind), Math.max(1000, msUntilExpiry - REFRESH_BUFFER_MS));
    } catch {
      if (kindRef.current !== activeKind) return;
      setState("error");
      timerRef.current = setTimeout(() => refresh(activeKind), ERROR_RETRY_MS);
    }
  }, []);

  useEffect(() => {
    setDataUrl(null);
    setState("loading");
    refresh(kind);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [kind, refresh]);

  useEffect(() => {
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    // Obrazovka musí zostať zapnutá, nech sa dá QR kód oskenovať terminálom
    // (veľký, kontrastný, na plný jas). Wake Lock nepodporujú
    // všetky prehliadače/OEM battery-saver politiky na Androide — zlyhanie
    // je neškodné pre samotné pípanie (kód sa aj tak obnovuje cez
    // visibilitychange nižšie), len obrazovka sa môže sama vypnúť.
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {
        // ignorované — nekritické
      }
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Keď sa obrazovka/karta vráti z pozadia (telefón sa odomkol, prehliadač
    // ju predtým uspal), naplánovaný refresh mohol zmeškať svoj čas úplne —
    // vynúť okamžitý refresh namiesto čakania, kým to dobehne samo.
    const forceRefresh = () => {
      if (document.visibilityState === "visible") refresh(kindRef.current);
    };
    document.addEventListener("visibilitychange", forceRefresh);
    window.addEventListener("focus", forceRefresh);
    return () => {
      document.removeEventListener("visibilitychange", forceRefresh);
      window.removeEventListener("focus", forceRefresh);
    };
  }, [refresh]);

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-cream px-6 py-10 text-center">
      {/* Nainštalované ako PWA (`display: "standalone"`, manifest.ts) — bez
          tohto tlačidla niet inej cesty von, prehliadačové UI (šípka späť,
          adresný riadok) v standalone móde chýba. */}
      <Link
        href="/moja-dochadzka"
        className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-2 text-sm font-semibold text-ink-soft shadow-sm transition hover:bg-cream-2"
      >
        <ArrowLeft size={16} /> Späť do appky
      </Link>

      <div>
        <p className="font-serif text-lg font-bold text-ink">{brand.name}</p>
        <p className="text-sm text-ink-faint">{employeeName}</p>
      </div>

      {canPunchBreaks && (
        <div className="flex rounded-full border border-line bg-paper p-1">
          <button
            type="button"
            onClick={() => setKind("zmena")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              kind === "zmena" ? "bg-orange text-white" : "text-ink-soft"
            }`}
          >
            Príchod/odchod
          </button>
          <button
            type="button"
            onClick={() => setKind("prestavka")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              kind === "prestavka" ? "bg-orange text-white" : "text-ink-soft"
            }`}
          >
            Prestávka
          </button>
        </div>
      )}

      <div className="flex aspect-square w-full max-w-sm items-center justify-center rounded-[24px] border border-line bg-paper p-6 shadow-sm">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- dátová URL generovaná knižnicou qrcode, next/image ju nevie optimalizovať
          <img src={dataUrl} alt="QR kód na pípanie" className="h-full w-full object-contain" />
        ) : (
          <p className="text-sm text-ink-faint">
            {state === "error" ? "Kód sa nepodarilo načítať, skúšam znova…" : "Načítavam kód…"}
          </p>
        )}
      </div>

      <p className="text-sm text-ink-faint">
        Kód sa obnovuje automaticky každých 25 sekúnd.{" "}
        {now && now.toLocaleTimeString("sk-SK", { timeZone: "Europe/Bratislava" })}
      </p>
    </div>
  );
}
