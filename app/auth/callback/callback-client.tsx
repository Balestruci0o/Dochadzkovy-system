"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function CallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = searchParams.get("next") ?? "/";
    const supabase = createSupabaseBrowserClient();

    async function complete() {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = searchParams.get("code");

      if (accessToken && refreshToken) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) {
          setError(setSessionError.message);
          return;
        }
      } else if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
      } else {
        setError("Odkaz je neplatný alebo mu vypršala platnosť.");
        return;
      }

      router.replace(next);
    }

    complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- beží raz pri mounte
  }, []);

  return <p className={error ? "text-late" : "text-ink-soft"}>{error ?? "Prihlasujem…"}</p>;
}
