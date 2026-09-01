const AVATAR_COLORS = ["#1C1B19", "#7E9082", "#E0700F", "#CF982A", "#5C6E60"];

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Deterministická farba z palety podľa mena, nech nie je pre všetkých rovnaká. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-bold text-white"
      style={{ background: avatarColor(name), width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  );
}
