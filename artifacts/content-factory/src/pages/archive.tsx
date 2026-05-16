import { useState } from "react";
import { useListPosts } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Archive, ChevronDown, ChevronUp, ExternalLink, FileText } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const DAY_LABELS: Record<number, { short: string; theme: string }> = {
  0: { short: "Вс", theme: "безопасность / этика" },
  1: { short: "Пн", theme: "российские технологии" },
  2: { short: "Вт", theme: "китайские технологии" },
  3: { short: "Ср", theme: "мировые новости" },
  4: { short: "Чт", theme: "мировые новости" },
  5: { short: "Пт", theme: "военные технологии" },
  6: { short: "Сб", theme: "дайджест" },
};

const VK_GROUP_NUMERIC = "238494545";

export default function ArchivePage() {
  const { data: posts, isLoading } = useListPosts();
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const published = (posts ?? [])
    .filter((p) => p.status === "published")
    .sort((a, b) => {
      const aTime = a.publishedAt ?? a.updatedAt;
      const bTime = b.publishedAt ?? b.updatedAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

  const toggle = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center text-muted-foreground">Загрузка архива...</div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground mt-1">
            {published.length} {published.length === 1 ? "пост" : published.length >= 2 && published.length <= 4 ? "поста" : "постов"} опубликовано
          </p>
        </div>
      </div>

      {published.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Archive className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>Опубликованных постов пока нет</p>
            <p className="text-xs mt-2 opacity-60">Здесь появятся посты после публикации в VK</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {published.map((post) => {
            const isOpen = expandedIds.has(post.id);
            const publishedAt = post.publishedAt ?? post.updatedAt;
            const charCount = post.content.length;
            const vkUrl = post.vkPostId
              ? `https://vk.com/wall-${VK_GROUP_NUMERIC}_${post.vkPostId}`
              : null;
            const dayInfo = post.recommendedDay != null ? DAY_LABELS[post.recommendedDay] : null;

            return (
              <Card key={post.id} className="overflow-hidden">
                <button
                  className="w-full text-left px-6 py-4 flex items-start gap-4 hover:bg-muted/30 transition-colors"
                  onClick={() => toggle(post.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                        {format(new Date(publishedAt), "d MMMM yyyy, HH:mm", { locale: ru })}
                      </span>
                      {dayInfo && (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                        >
                          {dayInfo.short} · {dayInfo.theme}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {charCount} симв.
                      </span>
                    </div>
                    <h3 className="font-medium text-base truncate">{post.title}</h3>
                    {!isOpen && (
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{post.content}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    {vkUrl && (
                      <a
                        href={vkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 transition-colors"
                        title="Открыть в VK"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t bg-muted/10 px-6 py-4 space-y-3">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                      {post.content}
                    </pre>
                    <div className="flex items-center justify-between pt-2 border-t border-muted">
                      <span className="text-xs text-muted-foreground">
                        Создан: {format(new Date(post.createdAt), "d MMMM yyyy", { locale: ru })}
                      </span>
                      {vkUrl ? (
                        <a
                          href={vkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Открыть в VK
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">VK ID не сохранён</span>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
