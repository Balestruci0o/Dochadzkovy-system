"use client";

import { ChevronRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/avatar";
import type { EmployeeListRow } from "@/app/(app)/zamestnanci/data";
import { PositionPill } from "./position-pill";

type PositionOption = { id: string; name: string };

export function EmployeeList({
  employees,
  positionOptions,
  canCreate,
}: {
  employees: EmployeeListRow[];
  positionOptions: PositionOption[];
  canCreate: boolean;
}) {
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter((e) => {
      if (!showInactive && !e.isActive) return false;
      if (positionFilter !== "all" && e.positionName !== positionFilter) return false;
      if (!q) return true;
      const haystack = `${e.firstName} ${e.lastName} ${e.email ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [employees, query, positionFilter, showInactive]);

  const activeCount = employees.filter((e) => e.isActive).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[10px] border border-line bg-cream-2 p-[3px]">
          <button
            type="button"
            onClick={() => setPositionFilter("all")}
            className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              positionFilter === "all" ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
            }`}
          >
            Všetci ({activeCount})
          </button>
          {positionOptions.map((p) => {
            const n = employees.filter((e) => e.isActive && e.positionName === p.name).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPositionFilter(p.name)}
                className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  positionFilter === p.name ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                }`}
              >
                {p.name} ({n})
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            zobraziť aj neaktívnych
          </label>
          <div className="flex items-center gap-2 rounded-[10px] border border-line bg-paper px-3 py-2">
            <Search size={16} className="text-ink-faint" />
            <input
              placeholder="Hľadať zamestnanca…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-48 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          {canCreate && (
            <Link
              href="/zamestnanci/novy"
              className="flex items-center gap-1.5 rounded-[10px] bg-orange px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark"
            >
              <Plus size={16} /> Nový zamestnanec
            </Link>
          )}
        </div>
      </div>

      {/* Mobil — karty namiesto tabuľky. Zoznam zamestnancov má málo stĺpcov
          (meno, pozícia, prevádzky, stav) ale meno/email/prevádzky sú
          premenlivo dlhé — horizontálny scroll tabuľky by fungoval (rovnaký
          vzor ako kalendár), ale pre "zoznam záznamov" (nie 2D mriežku ako
          kalendár deň×zamestnanec) je karta na celú šírku čitateľnejšia než
          scrollovanie tabuľky nabok. */}
      <div className="flex flex-col gap-2 md:hidden">
        {filtered.map((e) => (
          <Link
            key={e.id}
            prefetch={false}
            href={`/zamestnanci/${e.id}`}
            className="flex items-center gap-3 rounded-[12px] border border-line bg-paper p-3 shadow-sm transition-colors hover:bg-cream"
          >
            <Avatar name={`${e.firstName} ${e.lastName}`} size={38} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <b className="truncate font-semibold text-ink">
                  {e.firstName} {e.lastName}
                </b>
                {e.isActive ? (
                  <span className="flex-none rounded-full bg-ok-tint px-2 py-0.5 text-[10.5px] font-semibold text-ok">Aktívny</span>
                ) : (
                  <span className="flex-none rounded-full bg-cream-2 px-2 py-0.5 text-[10.5px] font-semibold text-ink-faint">Neaktívny</span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <PositionPill name={e.positionName} color={e.positionColor} />
                {e.workplaces.map((w) => (
                  <span key={w.id} className="rounded-full bg-cream-2 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                    {w.name}
                  </span>
                ))}
              </div>
            </div>
            <ChevronRight size={17} className="flex-none text-ink-faint" />
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="rounded-[12px] border border-line bg-paper px-4 py-10 text-center text-sm text-ink-faint shadow-sm">
            Žiadny zamestnanec nezodpovedá filtru.
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-[14px] border border-line bg-paper shadow-sm md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-ink-faint">
              <th className="px-4 py-3">Zamestnanec</th>
              <th className="px-4 py-3">Pozícia</th>
              <th className="px-4 py-3">Prevádzky</th>
              <th className="px-4 py-3">Stav</th>
              <th className="w-8 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {/* prefetch={false} na všetkých 5 <Link> na riadok — rovnaký nález ako
                v Sidebar/SettingsTabs: default prefetch spúšťa
                background RSC fetch pre KAŽDÝ riadok, čo scrolne do viewportu,
                nielen pri hoveri/kliku — s viac zamestnancami by to bol ten istý
                "prefetch storm" (N getUser() volaní + N DB dotazov navyše). Klik
                má aj tak okamžitú vizuálnu odozvu vďaka `[id]/loading.tsx`. */}
            {filtered.map((e) => (
              <tr
                key={e.id}
                className="cursor-pointer border-b border-line-soft text-sm transition-colors last:border-none hover:bg-cream"
              >
                <td className="p-0">
                  <Link prefetch={false} href={`/zamestnanci/${e.id}`} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={`${e.firstName} ${e.lastName}`} size={38} />
                    <div>
                      <b className="font-semibold text-ink">
                        {e.firstName} {e.lastName}
                      </b>
                      {e.email && <div className="mt-0.5 text-xs text-ink-faint">{e.email}</div>}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link prefetch={false} href={`/zamestnanci/${e.id}`} className="block">
                    <PositionPill name={e.positionName} color={e.positionColor} />
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link prefetch={false} href={`/zamestnanci/${e.id}`} className="flex flex-wrap gap-1.5">
                    {e.workplaces.map((w) => (
                      <span
                        key={w.id}
                        className="rounded-full bg-cream-2 px-2 py-0.5 text-xs font-medium text-ink-soft"
                      >
                        {w.name}
                      </span>
                    ))}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link prefetch={false} href={`/zamestnanci/${e.id}`} className="block">
                    {e.isActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-tint px-2.5 py-1 text-xs font-semibold text-ok">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" /> Aktívny
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-2 px-2.5 py-1 text-xs font-semibold text-ink-faint">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" /> Neaktívny
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link prefetch={false} href={`/zamestnanci/${e.id}`}>
                    <ChevronRight size={17} className="text-ink-faint" />
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-faint">
                  Žiadny zamestnanec nezodpovedá filtru.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
