"use client";

import { Check, Copy, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { HelpTooltip } from "@/components/help/help-tooltip";
import { GLOSSARY } from "@/lib/help/glossary";

export function TerminalSecretReveal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-md border-2 border-late bg-late-tint p-4">
      <div className="flex items-start gap-2.5">
        <ShieldAlert size={20} className="mt-0.5 flex-none text-late" />
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5">
            <b className="text-sm font-bold text-ink">Prístupový kľúč terminálu — zobrazí sa len teraz</b>
            <HelpTooltip term={GLOSSARY.pristupovyKluc.term} explanation={GLOSSARY.pristupovyKluc.explanation} />
          </span>
          <p className="mt-1 text-xs text-ink-soft">
            Zapíš si ho alebo skopíruj priamo do konfigurácie terminálu. Po zatvorení tohto okna už nie je
            nikde k dispozícii — v databáze je uložený len jeho hash.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-line bg-paper px-3 py-2 text-xs font-mono text-ink">
              {secret}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(secret);
                setCopied(true);
              }}
              className="flex flex-none items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-2 text-xs font-semibold text-ink-soft transition hover:bg-cream-2"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Skopírované" : "Kopírovať"}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark"
          >
            Uložil/a som si ho, zavrieť
          </button>
        </div>
      </div>
    </div>
  );
}
