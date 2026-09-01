"use client";

import { Calendar, Clock, FileText, Search, Settings, Smartphone, Umbrella, X, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { HelpScreenshot } from "@/components/help/screenshot-lightbox";
import { searchHelpArticles } from "@/lib/help/search";
import type { HelpArticle, HelpIconKey, HelpTopic } from "@/lib/help/types";

const ICONS: Record<HelpIconKey, LucideIcon> = {
  clock: Clock,
  calendar: Calendar,
  umbrella: Umbrella,
  "file-text": FileText,
  settings: Settings,
  smartphone: Smartphone,
};

function ArticleDetail({ article, onBack }: { article: HelpArticle; onBack: () => void }) {
  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <button type="button" onClick={onBack} className="mb-3 text-xs font-semibold text-ink-soft hover:text-orange">
        ← Späť na zoznam
      </button>
      <h2 className="font-serif text-xl font-bold text-ink">{article.title}</h2>
      {article.placeholder && (
        <p className="mt-2 inline-block rounded-full bg-gold-tint px-3 py-1 text-xs font-semibold text-gold">Táto časť sa ešte pripravuje</p>
      )}
      <ol className="mt-4 flex flex-col gap-4">
        {article.steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sage-tint text-xs font-bold text-sage-dark">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed text-ink">{step.text}</p>
              {step.screenshot && <HelpScreenshot src={`/help/screenshots/${step.screenshot}.png`} alt={step.text} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HelpBrowser({ topics }: { topics: HelpTopic[] }) {
  const [query, setQuery] = useState("");
  const [activeTopicSlug, setActiveTopicSlug] = useState<string | undefined>(topics[0]?.slug);
  const [activeArticleSlug, setActiveArticleSlug] = useState<string | null>(null);

  const activeTopic = topics.find((t) => t.slug === activeTopicSlug);
  const activeArticle = activeTopic?.articles.find((a) => a.slug === activeArticleSlug) ?? null;
  const searchHits = useMemo(() => searchHelpArticles(topics, query), [topics, query]);

  function openArticle(topic: HelpTopic, article: HelpArticle) {
    setActiveTopicSlug(topic.slug);
    setActiveArticleSlug(article.slug);
    setQuery("");
  }

  if (topics.length === 0) {
    return <div className="rounded-[14px] border border-line bg-paper p-6 text-sm text-ink-soft shadow-sm">Pomocník pre tvoju rolu zatiaľ nie je pripravený.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveArticleSlug(null);
          }}
          placeholder="Napríklad: ako podať dovolenku"
          className="w-full rounded-[12px] border border-line bg-paper py-3 pl-10 pr-10 text-sm text-ink outline-none focus:border-orange"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Vymazať vyhľadávanie"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {query ? (
        <div className="flex flex-col gap-2">
          {searchHits.length === 0 && <p className="rounded-[14px] border border-line bg-paper p-5 text-sm text-ink-soft shadow-sm">Nič sa nenašlo. Skús iné slovo.</p>}
          {searchHits.map(({ topic, article }) => (
            <button
              key={`${topic.slug}/${article.slug}`}
              type="button"
              onClick={() => openArticle(topic, article)}
              className="rounded-[12px] border border-line bg-paper p-4 text-left shadow-sm transition hover:border-orange"
            >
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">{topic.label}</span>
              <div className="mt-0.5 font-semibold text-ink">{article.title}</div>
              <div className="text-sm text-ink-soft">{article.summary}</div>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-line px-1 pb-px">
            {topics.map((topic) => {
              const Icon = ICONS[topic.icon];
              const active = topic.slug === activeTopicSlug;
              return (
                <button
                  key={topic.slug}
                  type="button"
                  onClick={() => {
                    setActiveTopicSlug(topic.slug);
                    setActiveArticleSlug(null);
                  }}
                  className={`flex flex-none items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                    active ? "border-orange text-orange" : "border-transparent text-ink-soft hover:text-ink"
                  }`}
                >
                  <Icon size={15} />
                  {topic.label}
                </button>
              );
            })}
          </div>

          {activeArticle ? (
            <ArticleDetail article={activeArticle} onBack={() => setActiveArticleSlug(null)} />
          ) : (
            <div className="flex flex-col gap-2">
              {activeTopic?.articles.map((article) => (
                <button
                  key={article.slug}
                  type="button"
                  onClick={() => setActiveArticleSlug(article.slug)}
                  className="rounded-[12px] border border-line bg-paper p-4 text-left shadow-sm transition hover:border-orange"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{article.title}</span>
                    {article.placeholder && <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">pripravuje sa</span>}
                  </div>
                  <div className="text-sm text-ink-soft">{article.summary}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
