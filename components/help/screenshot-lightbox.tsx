"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Screenshot v návode je v texte zámerne malý (nemá dominovať kroku) — klik
 * ho zväčší cez modálne okno, nech je vidno aj detail (kam presne ukazuje
 * rámček). Zavrieť: X, klik mimo obrázka, alebo Escape — rovnaký vzor ako
 * `HelpTooltip`/`NotificationBell` (klik mimo zatvorí), navyše ešte
 * zablokovaný scroll pozadia, kým je otvorené (rovnako ako `AppShell`
 * mobilný drawer).
 */
export function HelpScreenshot({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Zväčšiť obrázok"
        className="mt-2.5 block max-w-full cursor-zoom-in overflow-hidden rounded-[10px] border border-line shadow-sm transition hover:border-orange sm:max-w-md"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- statické pomocné screenshoty, žiadny next/image pipeline v tomto projekte */}
        <img src={src} alt={alt} className="block w-full" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/80 p-4 sm:p-8"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Zavrieť"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-paper text-ink shadow-lg transition hover:bg-cream-2 sm:right-6 sm:top-6"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- statické pomocné screenshoty, žiadny next/image pipeline v tomto projekte */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full cursor-default rounded-[10px] object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
