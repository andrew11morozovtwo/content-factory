import { useState } from "react";
import {
  useListPosts,
  useDeletePost,
  useUpdatePost,
  getListPostsQueryKey,
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
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

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

  const filteredPosts = posts?.filter(
    (post) =>
      post.title.toLowerCase().includes(search.toLowerCase()) ||
      post.content.toLowerCase().includes(search.toLowerCase()),
  ) || [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });

  const handleDelete = async (id: number) => {
    if (confirm("Точно удалить пост?")) {
      await deletePost.mutateAsync({ id });
      invalidate();
    }
  };

  const openEditor = (post: { id: number; title: string; content: string }) => {
    setEditing({ id: post.id, title: post.title, content: post.content });
    setSelectedDate(undefined);
    setCalendarOpen(false);
  };

  const closeEditor = () => {
    setEditing(null);
    setSelectedDate(undefined);
    setCalendarOpen(false);
  };

  const saveWith = async (patch: { status: string; scheduledAt?: string | null }) => {
    if (!editing) return;
    setSaving(true);
    try {
      await updatePost.mutateAsync({
        id: editing.id,
        data: {
          title: editing.title,
          content: editing.content,
          ...patch,
        },
      });
      invalidate();
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const handleDraft = () => saveWith({ status: "draft", scheduledAt: null });

  const handleSchedule = (date: Date) => {
    setCalendarOpen(false);
    saveWith({ status: "scheduled", scheduledAt: date.toISOString() });
  };

  const handlePublishNow = () => saveWith({ status: "published", scheduledAt: null });

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
                    <div className="flex items-center gap-3 mb-2">
                      <Badge
                        variant="secondary"
                        className={
                          STATUS_MAP[post.status as keyof typeof STATUS_MAP]?.color +
                          " border-none"
                        }
                      >
                        {STATUS_MAP[post.status as keyof typeof STATUS_MAP]?.label ?? post.status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(post.createdAt), "d MMMM yyyy", { locale: ru })}
                      </span>
                      {post.scheduledAt && (
                        <span className="text-sm text-orange-600">
                          → {format(new Date(post.scheduledAt), "d MMMM yyyy", { locale: ru })}
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

                {/* ── Панель редактирования (раскрывается) ── */}
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
                          <Button
                            variant="outline"
                            disabled={saving}
                            className="gap-2"
                          >
                            <CalendarIcon className="w-4 h-4" />
                            {selectedDate
                              ? format(selectedDate, "d MMMM yyyy", { locale: ru })
                              : "Запланировать"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(date) => {
                              if (date) {
                                setSelectedDate(date);
                                handleSchedule(date);
                              }
                            }}
                            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>

                      <Button
                        onClick={handlePublishNow}
                        disabled={saving}
                        className="gap-2"
                      >
                        <Zap className="w-4 h-4" />
                        Опубликовать немедленно
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() =>
                          saveWith({ status: post.status, scheduledAt: post.scheduledAt ?? null })
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
