"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Odosielacie tlačidlo vo formulári bez vlastného `useActionState` (rýchle
 * akcie v zoznamoch — schváliť/zamietnuť/aktivovať/vymazať). `useFormStatus`
 * číta `pending` z najbližšieho nadradeného `<form>`, takže klik viditeľne
 * "zaberie" (spinner + disabled) aj bez stavu v komponente.
 */
export function SubmitButton({
  children,
  pendingContent,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pendingContent?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} {...props}>
      {pending ? (pendingContent ?? <Loader2 size={14} className="animate-spin" />) : children}
    </button>
  );
}
