import { Suspense } from "react";
import { CallbackClient } from "./callback-client";

/**
 * Cieľ pozývacích/reset odkazov. Supabase (admin.generateLink) posiela
 * tokeny v URL FRAGMENTE (`#access_token=...&refresh_token=...`), nie ako
 * `?code=` — fragment sa nikdy neposiela na server, takže session sa musí
 * dokončiť client-side (CallbackClient), nie v Route Handleri.
 */
export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <Suspense fallback={<p className="text-ink-soft">Prihlasujem…</p>}>
        <CallbackClient />
      </Suspense>
    </div>
  );
}
