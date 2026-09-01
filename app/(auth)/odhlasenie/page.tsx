import { logoutAction } from "./actions";

/**
 * Dočasná samostatná stránka na odhlásenie, kým Blok 3 nepridá tlačidlo
 * priamo do navigácie. Zámerne POST (server action), nie GET-link — GET
 * odhlásenie by šlo spustiť z cudzej stránky (CSRF).
 */
export default function OdhlaseniePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <form action={logoutAction} className="rounded-lg border border-line bg-paper p-8 shadow-sm text-center">
        <p className="mb-4 text-ink">Naozaj sa chceš odhlásiť?</p>
        <button
          type="submit"
          className="rounded-md bg-ink px-4 py-2 font-semibold text-white transition hover:opacity-90"
        >
          Odhlásiť sa
        </button>
      </form>
    </div>
  );
}
