"use client";

import { Loader2 } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

/**
 * Export (PDF/Excel) je `Content-Disposition: attachment` — klik na obyčajné
 * `<a href>` spustí sťahovanie na pozadí BEZ akejkoľvek vizuálnej zmeny, kým
 * súbor nedorazí (žiadna navigácia, žiadny natívny "loading" stav). Preto
 * sťahujeme cez `fetch`, počas čoho nahradíme obsah spinnerom, a výsledný
 * blob spustíme ako stiahnutie sami — to isté miesto vie zobraziť aj chybu
 * namiesto tichého zlyhania.
 */
export function ExportLink({
  href,
  children,
  className,
  title,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Export zlyhal.");
      }
      const blob = await res.blob();
      const filename = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "export";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export zlyhal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <a href={href} onClick={handleClick} aria-disabled={loading} className={className} title={title}>
        {loading ? <Loader2 size={16} className="animate-spin" /> : children}
      </a>
      {error && (
        <span className="absolute right-0 top-full z-10 mt-1 w-max max-w-[240px] rounded-md border border-late/40 bg-late-tint px-2.5 py-1.5 text-xs text-late shadow-sm">
          {error}
        </span>
      )}
    </span>
  );
}
