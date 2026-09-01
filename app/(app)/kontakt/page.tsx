import { Headset, Mail, Phone, Shield, Users } from "lucide-react";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";
import { getKontaktData, type ContactPerson } from "./data";

function ContactCard({ icon, title, people, emptyMessage }: { icon: ReactNode; title: string; people: ContactPerson[]; emptyMessage: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-sage-tint text-sage-dark">{icon}</span>
        <h3 className="font-serif text-lg font-bold text-ink">{title}</h3>
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-ink-faint">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {people.map((p, i) => (
            <div key={i} className={i > 0 ? "border-t border-line-soft pt-3" : ""}>
              <b className="text-sm text-ink">{p.fullName}</b>
              <div className="mt-1 flex flex-col gap-1 text-sm text-ink-soft">
                {p.email && (
                  <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 hover:text-orange hover:underline">
                    <Mail size={14} /> {p.email}
                  </a>
                )}
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 hover:text-orange hover:underline">
                    <Phone size={14} /> {p.phone}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function KontaktPage() {
  const user = await requireUser();
  const data = await getKontaktData(user);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <ContactCard
        icon={<Headset size={18} />}
        title="Podpora"
        people={data.support ? [data.support] : []}
        emptyMessage="Kontaktné údaje podpory zatiaľ nie sú vyplnené (Nastavenia → Kontá)."
      />
      <ContactCard icon={<Shield size={18} />} title="Majiteľ" people={data.owners} emptyMessage="Žiadny ďalší majiteľ v organizácii." />
      <ContactCard
        icon={<Users size={18} />}
        title="Manažér"
        people={data.managers}
        emptyMessage="K tvojej prevádzke zatiaľ nie je priradený žiadny manažér."
      />
    </div>
  );
}
