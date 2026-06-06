import { useState } from "react";
import {
  useListPosts,
  useDeletePost,
  useUpdatePost,
  getListPostsQueryKey,
  PostUpdateStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Search,
  Trash2,
  Edit2,
  Plus,
  Library,
  CalendarIcon,
  X,
  ArchiveRestore,
  Zap,
  Save,
  AlertTriangle,
  Cpu,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";
import { format, isSameDay, startOfDay } from "date-fns";
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

const CHANNEL_MAP: Record<string, { label: string; icon: typeof Cpu; color: string }> = {
  "ya-inzhener": {
    label: "Я-Инженер",
    icon: Cpu,
    color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  },
  "bezopasnost": {
    label: "Безопасность",
    icon: ShieldCheck,
    color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  },
};

const STATUS_MAP = {
  draft: { label: "Черновик", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
  scheduled: { label: "Запланирован", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  published: { label: "Опубликован", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  rejected: { label: "Отклонен", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

interface EditState {
  id: number;
  title: string;
  content: string;
  channel: string;
  currentStatus: PostUpdateStatus;
  currentScheduledAt: string | null;
}

interface ConflictInfo {
  date: Date;
  conflictingTitle: string;
}

export default function Posts() {
  const { data: posts, isLoading } = useListPosts();
  const deletePost = useDeletePost();
  const updatePost = useUpdatePost();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const filteredPosts = (posts ?? [])
    .filter(
      (post) =>
        post.status !== "published" &&
        (post.title.toLowerCase().includes(search.toLowerCase()) ||
          post.content.toLowerCase().includes(search.toLowerCase())),
    )
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  // Даты с уже запланированными постами (для календаря)
  const scheduledDates: Date[] = (posts ?? [])
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .map((p) => new Date(p.scheduledAt!));

  const findConflict = (date: Date, excludeId: number) =>
    (posts ?? []).find(
      (p) =>
        p.id !== excludeId &&
        p.status === "scheduled" &&
        p.scheduledAt &&
        isSameDay(new Date(p.scheduledAt), date),
    ) ?? null;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });

  const handleDelete = async (id: number) => {
    if (confirm("Точно удалить пост?")) {
      await deletePost.mutateAsync({ id });
      invalidate();
    }
  };

  const openEditor = (post: {
    id: number;
    title: string;
    content: string;
    status: string;
    channel: string;
    scheduledAt: string | null;
  }) => {
    setEditing({
      id: post.id,
      title: post.title,
      content: post.content,
      channel: post.channel ?? "ya-inzhener",
      currentStatus: post.status as PostUpdateStatus,
      currentScheduledAt: post.scheduledAt,
    });
    setSelectedDate(undefined);
    setCalendarOpen(false);
    setConflict(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setSelectedDate(undefined);
    setCalendarOpen(false);
    setConflict(null);
  };

  const saveWith = async (patch: { status: PostUpdateStatus; scheduledAt?: string | null }) => {
    if (!editing) return;
    setSaving(true);
    try {
      await updatePost.mutateAsync({
        id: editing.id,
        data: { title: editing.title, content: editing.content, channel: editing.channel as "ya-inzhener" | "bezopasnost", ...patch },
      });
      invalidate();
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const handleDraft = () => saveWith({ status: "draft", scheduledAt: null });

  const handlePublishNow = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updatePost.mutateAsync({
        id: editing.id,
        data: { title: editing.title, content: editing.content },
      });
      await fetch(`/api/posts/${editing.id}/publish`, { method: "POST" });
      invalidate();
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const atNoon = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  const trySchedule = (date: Date) => {
    if (!editing) return;
    setCalendarOpen(false);
    const noon = atNoon(date);
    const existing = findConflict(noon, editing.id);
    if (existing) {
      setSelectedDate(noon);
      setConflict({ date: noon, conflictingTitle: existing.title });
    } else {
      setConflict(null);
      saveWith({ status: "scheduled", scheduledAt: noon.toISOString() });
    }
  };

  const forceSchedule = () => {
    if (!conflict) return;
    setConflict(null);
    saveWith({ status: "scheduled", scheduledAt: conflict.date.toISOString() });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по текстам и заголовкам..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Link href="/">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Новый пост
          </Button>
        </Link>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Загрузка библиотеки...</div>
        ) : filteredPosts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center text-muted-foreground">
              <Library className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Постов не найдено</p>
            </CardContent>
          </Card>
        ) : (
          filteredPosts.map((post) => {
            const isEditingThis = editing?.id === post.id;
            return (
              <Card key={post.id} className="overflow-hidden">
                {/* ── Заголовок карточки ── */}
                <div className="flex flex-col sm:flex-row">
                  <div className="p-6 flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <Badge
                        variant="secondary"
                        className={
                          (STATUS_MAP[post.status as keyof typeof STATUS_MAP]?.color ?? "") +
                          " border-none"
                        }
                      >
                        {STATUS_MAP[post.status as keyof typeof STATUS_MAP]?.label ?? post.status}
                      </Badge>
                      {(() => {
                        const ch = CHANNEL_MAP[post.channel ?? "ya-inzhener"];
                        const Icon = ch?.icon ?? Cpu;
                        return ch ? (
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${ch.color}`}>
                            <Icon className="w-3 h-3" />
                            {ch.label}
                          </span>
                        ) : null;
                      })()}
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(post.createdAt), "d MMMM yyyy", { locale: ru })}
                      </span>
                      {post.scheduledAt && (
                        <span className="text-sm text-orange-600 font-medium">
                          → {format(new Date(post.scheduledAt), "d MMMM yyyy", { locale: ru })}
                        </span>
                      )}
                      {post.recommendedDay != null && DAY_LABELS[post.recommendedDay] && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                          title={`AI рекомендует: ${DAY_LABELS[post.recommendedDay].theme}`}
                        >
                          🤖 {DAY_LABELS[post.recommendedDay].short} · {DAY_LABELS[post.recommendedDay].theme}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-lg mb-2 line-clamp-1">{post.title}</h3>
                    <p className="text-muted-foreground text-sm line-clamp-2">{post.content}</p>
                  </div>

                  <div className="bg-muted/30 p-4 sm:border-l flex flex-row sm:flex-col items-center justify-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={
                        isEditingThis
                          ? "text-primary bg-primary/10"
                          : "text-muted-foreground hover:text-primary"
                      }
                      onClick={() => (isEditingThis ? closeEditor() : openEditor(post))}
                      title={isEditingThis ? "Закрыть редактор" : "Редактировать"}
                    >
                      {isEditingThis ? <X className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(post.id)}
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* ── Панель редактирования ── */}
                {isEditingThis && editing && (
                  <div className="border-t bg-muted/10 p-6 space-y-4">
                    <Input
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      placeholder="Заголовок"
                      className="font-medium"
                    />
                    <Textarea
                      value={editing.content}
                      onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                      rows={12}
                      className="resize-none font-mono text-sm leading-relaxed"
                      placeholder="Текст поста..."
                    />

                    {/* Канал */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Канал:</span>
                      {(["ya-inzhener", "bezopasnost"] as const).map((ch) => {
                        const info = CHANNEL_MAP[ch];
                        const Icon = info.icon;
                        const isActive = editing.channel === ch;
                        return (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => setEditing({ ...editing, channel: ch })}
                            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                              isActive ? info.color + " font-semibold" : "border-border text-muted-foreground hover:border-primary/50"
                            }`}
                          >
                            <Icon className="w-3 h-3" />
                            {info.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Предупреждение о конфликте */}
                    {conflict && (
                      <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 p-4">
                        <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-3">
                          <p className="text-sm text-orange-800 dark:text-orange-300">
                            <strong>
                              {format(conflict.date, "d MMMM yyyy", { locale: ru })}
                            </strong>{" "}
                            уже занято постом:{" "}
                            <span className="italic">«{conflict.conflictingTitle}»</span>
                          </p>
                          <p className="text-xs text-orange-700 dark:text-orange-400">
                            По правилу — один пост в день. Вы можете выбрать другую дату или поставить два поста на одну дату.
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300"
                              onClick={() => {
                                setConflict(null);
                                setSelectedDate(undefined);
                                setCalendarOpen(true);
                              }}
                            >
                              Выбрать другую дату
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300"
                              onClick={forceSchedule}
                              disabled={saving}
                            >
                              Всё равно поставить
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Кнопки действий */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="outline"
                        onClick={handleDraft}
                        disabled={saving}
                        className="gap-2"
                      >
                        <ArchiveRestore className="w-4 h-4" />
                        Обратно в черновики
                      </Button>

                      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" disabled={saving} className="gap-2">
                            <CalendarIcon className="w-4 h-4" />
                            {selectedDate && !conflict
                              ? format(selectedDate, "d MMMM yyyy", { locale: ru })
                              : "Запланировать"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(date) => {
                              if (date) trySchedule(date);
                            }}
                            disabled={(date) =>
                              date < startOfDay(new Date())
                            }
                            modifiers={{ scheduled: scheduledDates }}
                            modifiersClassNames={{
                              scheduled:
                                "bg-orange-100 text-orange-800 font-semibold dark:bg-orange-900/40 dark:text-orange-300",
                            }}
                            weekStartsOn={1}
                            initialFocus
                          />
                          <div className="px-3 pb-3 pt-1 text-xs text-muted-foreground flex items-center gap-1.5">
                            <span className="inline-block w-3 h-3 rounded bg-orange-200 dark:bg-orange-800" />
                            Дата уже занята
                          </div>
                        </PopoverContent>
                      </Popover>

                      <Button onClick={handlePublishNow} disabled={saving} className="gap-2">
                        <Zap className="w-4 h-4" />
                        Опубликовать немедленно
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() =>
                          saveWith({
                            status: editing.currentStatus,
                            scheduledAt: editing.currentScheduledAt,
                          })
                        }
                        disabled={saving}
                        className="gap-2 ml-auto"
                      >
                        <Save className="w-4 h-4" />
                        Сохранить
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
