"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Kontextová "?" ikonka pri zložitých pojmoch (úväzok, turnus, režim
 * prestávky, vedúci zmeny, prístupový kľúč) — klik ukáže krátke vysvetlenie
 * v popovere, nie samostatná stránka. Text je vždy z `lib/help/glossary.ts`
 * (jedno miesto pravdy, rovnaké ako v článkoch pomocníka).
 *
 * BEZPEČNÉ vnorenie do `<label>`: tlačidlo je vlastný, samostatný interaktívny
 * prvok — klik naň prehliadač NEPRESMERUJE na priradený checkbox/input v tom
 * istom labeli (also `preventDefault`/`stopPropagation` navyše, pre istotu
 * naprieč prehliadačmi).
 */
export function HelpTooltip({ term, explanation }: { term: string; explanation: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Čo znamená "${term}"`}
        aria-expanded={open}
        className="inline-flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full border border-ink-faint/60 text-[10px] font-bold leading-none text-ink-faint transition-colors hover:border-orange hover:text-orange"
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-[10px] border border-line bg-paper p-3 text-left text-xs normal-case leading-relaxed tracking-normal text-ink-soft shadow-lg"
        >
          <b className="mb-1 block font-serif text-[13.5px] font-bold text-ink">{term}</b>
          {explanation}
        </div>
      )}
    </span>
  );
}
