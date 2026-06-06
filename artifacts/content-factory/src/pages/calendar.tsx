import { useState } from "react";
import {
  useListPosts,
  useGetPostStats,
  useUpdatePost,
  getListPostsQueryKey,
  PostUpdateStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  FileEdit,
  Zap,
  Save,
  ArchiveRestore,
  AlertTriangle,
} from "lucide-react";
import { format, isSameDay, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";

interface EditState {
  id: number;
  title: string;
  content: string;
  currentStatus: PostUpdateStatus;
  currentScheduledAt: string | null;
}

interface ConflictInfo {
  date: Date;
  conflictingTitle: string;
}

interface Props {
  channel: "ya-inzhener" | "bezopasnost";
}

export default function CalendarPage({ channel }: Props) {
  const { data: posts, isLoading } = useListPosts();
  const { data: stats } = useGetPostStats();
  const updatePost = useUpdatePost();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<EditState | null>(null);
  const [schedCalOpen, setSchedCalOpen] = useState(false);
  const [schedDate, setSchedDate] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const scheduledPosts = (posts ?? []).filter(
    (p) => p.status === "scheduled" && p.scheduledAt && (p.channel ?? "ya-inzhener") === channel,
  );
  const scheduledDates = scheduledPosts.map((p) => new Date(p.scheduledAt!));

  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return d;
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });

  const openEditor = (post: (typeof scheduledPosts)[0]) => {
    setEditing({
      id: post.id,
      title: post.title,
      content: post.content,
      currentStatus: post.status as PostUpdateStatus,
      currentScheduledAt: post.scheduledAt,
    });
    setSchedDate(post.scheduledAt ? new Date(post.scheduledAt) : undefined);
    setConflict(null);
    setSchedCalOpen(false);
  };

  const closeEditor = () => {
    setEditing(null);
    setSchedDate(undefined);
    setSchedCalOpen(false);
    setConflict(null);
  };

  const saveWith = async (patch: {
    status: PostUpdateStatus;
    scheduledAt?: string | null;
  }) => {
    if (!editing) return;
    setSaving(true);
    try {
      await updatePost.mutateAsync({
        id: editing.id,
        data: { title: editing.title, content: editing.content, ...patch },
      });
      invalidate();
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const findConflict = (date: Date, excludeId: number) =>
    (posts ?? []).find(
      (p) =>
        p.id !== excludeId &&
        p.status === "scheduled" &&
        p.scheduledAt &&
        isSameDay(new Date(p.scheduledAt), date),
    ) ?? null;

  const atNoon = (date: Date) => {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  const trySchedule = (date: Date) => {
    if (!editing) return;
    setSchedCalOpen(false);
    const noon = atNoon(date);
    const existing = findConflict(noon, editing.id);
    if (existing) {
      setSchedDate(noon);
      setConflict({ date: noon, conflictingTitle: existing.title });
    } else {
      setConflict(null);
      void saveWith({ status: "scheduled", scheduledAt: noon.toISOString() });
    }
  };

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

  const handleDayClick = (day: Date) => {
    const post = scheduledPosts.find((p) =>
      isSameDay(new Date(p.scheduledAt!), day),
    );
    if (post) openEditor(post);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* ── Плашки статистики ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Черновики</CardTitle>
            <FileEdit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.draft ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Запланировано</CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.scheduled ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Опубликовано</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.published ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего</CardTitle>
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Интерактивный календарь ── */}
      <Card>
        <CardHeader>
          <CardTitle>Расписание публикаций</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Calendar
            mode="single"
            numberOfMonths={2}
            weekStartsOn={1}
            locale={ru}
            modifiers={{ scheduled: scheduledDates }}
            modifiersClassNames={{
              scheduled:
                "!bg-orange-100 !text-orange-800 font-semibold dark:!bg-orange-900/40 dark:!text-orange-300 cursor-pointer hover:!bg-orange-200 dark:hover:!bg-orange-800/60",
            }}
            onDayClick={handleDayClick}
            classNames={{
              months: "flex flex-col sm:flex-row gap-6 justify-center",
            }}
          />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded bg-orange-200 dark:bg-orange-800 shrink-0" />
            Запланированная публикация — нажмите для редактирования
          </p>
        </CardContent>
      </Card>

      {/* ── Диалог редактирования ── */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileEdit className="w-4 h-4" />
              Редактирование поста
            </DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="space-y-4 pt-1">
              {editing.currentScheduledAt && (
                <Badge
                  variant="secondary"
                  className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-none"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  {format(new Date(editing.currentScheduledAt), "d MMMM yyyy, HH:mm", { locale: ru })}
                </Badge>
              )}

              <Input
                value={editing.title}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
                placeholder="Заголовок"
                className="font-medium"
              />
              <Textarea
                value={editing.content}
                onChange={(e) =>
                  setEditing({ ...editing, content: e.target.value })
                }
                rows={12}
                className="resize-none font-mono text-sm leading-relaxed"
                placeholder="Текст поста..."
              />

              {/* Конфликт дат */}
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
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300"
                        onClick={() => {
                          setConflict(null);
                          setSchedDate(undefined);
                          setSchedCalOpen(true);
                        }}
                      >
                        Выбрать другую дату
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300"
                        onClick={() => {
                          setConflict(null);
                          void saveWith({
                            status: "scheduled",
                            scheduledAt: conflict.date.toISOString(),
                          });
                        }}
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
                  onClick={() =>
                    void saveWith({ status: "draft", scheduledAt: null })
                  }
                  disabled={saving}
                  className="gap-2"
                >
                  <ArchiveRestore className="w-4 h-4" />
                  В черновики
                </Button>

                <Popover open={schedCalOpen} onOpenChange={setSchedCalOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" disabled={saving} className="gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      {schedDate && !conflict
                        ? format(schedDate, "d MMMM yyyy", { locale: ru })
                        : "Перенести"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={schedDate}
                      onSelect={(date) => {
                        if (date) trySchedule(date);
                      }}
                      disabled={(date) => date < startOfDay(new Date())}
                      modifiers={{ scheduled: scheduledDates }}
                      modifiersClassNames={{
                        scheduled:
                          "bg-orange-100 text-orange-800 font-semibold dark:bg-orange-900/40 dark:text-orange-300",
                      }}
                      weekStartsOn={1}
                      locale={ru}
                      initialFocus
                    />
                    <div className="px-3 pb-3 pt-1 text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded bg-orange-200 dark:bg-orange-800" />
                      Дата уже занята
                    </div>
                  </PopoverContent>
                </Popover>

                <Button
                  onClick={() => void handlePublishNow()}
                  disabled={saving}
                  className="gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Опубликовать сейчас
                </Button>

                <Button
                  variant="secondary"
                  onClick={() =>
                    void saveWith({
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
        </DialogContent>
      </Dialog>

      {/* ── Ближайшие публикации (7 дней) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Ближайшие публикации</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              Загрузка...
            </div>
          ) : (
            <div className="space-y-3">
              {next7Days.map((day) => {
                const dayPosts = scheduledPosts.filter((p) => {
                  const d = new Date(p.scheduledAt!);
                  return (
                    d.getFullYear() === day.getFullYear() &&
                    d.getMonth() === day.getMonth() &&
                    d.getDate() === day.getDate()
                  );
                });
                const isToday =
                  day.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={day.toISOString()}
                    className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                      isToday
                        ? "border-primary/40 bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`flex flex-col items-center justify-center w-16 h-16 rounded-md shrink-0 ${
                        isToday
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="text-xs uppercase font-medium opacity-80">
                        {format(day, "EEE", { locale: ru })}
                      </span>
                      <span className="text-lg font-bold leading-tight">
                        {format(day, "d", { locale: ru })}
                      </span>
                      <span className="text-xs uppercase">
                        {format(day, "MMM", { locale: ru })}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      {dayPosts.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic mt-1">
                          Публикаций нет
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {dayPosts
                            .sort(
                              (a, b) =>
                                new Date(a.scheduledAt!).getTime() -
                                new Date(b.scheduledAt!).getTime(),
                            )
                            .map((post) => (
                              <button
                                key={post.id}
                                className="w-full flex items-center gap-3 text-left hover:bg-muted/60 rounded px-2 py-1 transition-colors group"
                                onClick={() => openEditor(post)}
                              >
                                <span className="text-sm text-muted-foreground shrink-0">
                                  {format(
                                    new Date(post.scheduledAt!),
                                    "HH:mm",
                                    { locale: ru },
                                  )}
                                </span>
                                <span className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                                  {post.title}
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
