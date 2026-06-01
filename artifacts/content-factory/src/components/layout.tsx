import { Link, useLocation } from "wouter";
import { PenSquare, CalendarDays, Library, Zap, Archive, Bot, Loader2, CheckCircle2, AlertTriangle, CalendarIcon } from "lucide-react";
import { ReactNode, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getListPostsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const ENGINEER_LINKS = [
  { href: "/", label: "Рабочий стол", icon: PenSquare },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/posts", label: "Библиотека", icon: Library },
  { href: "/archive", label: "Архив", icon: Archive },
];

const SECURITY_LINKS = [
  { label: "Рабочий стол", icon: PenSquare },
  { label: "Календарь", icon: CalendarDays },
  { label: "Библиотека", icon: Library },
  { label: "Архив", icon: Archive },
];

type AutoState =
  | { stage: "idle" }
  | { stage: "loading" }
  | { stage: "done"; post: { title: string; scheduledAt: string | null; content: string } }
  | { stage: "error"; message: string };

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoState, setAutoState] = useState<AutoState>({ stage: "idle" });
  const isGenerating = useRef(false);
  const queryClient = useQueryClient();

  const currentLabel =
    ENGINEER_LINKS.find((l) => l.href === location)?.label ?? "Контент Фабрика";

  const handleAutoGenerate = async () => {
    if (isGenerating.current) return;
    isGenerating.current = true;
    setAutoState({ stage: "loading" });
    try {
      const resp = await fetch("/api/auto-generate", { method: "POST" });
      if (!resp.ok) {
        const err = (await resp.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const post = (await resp.json()) as { title: string; scheduledAt: string | null; content: string };
      await queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      setAutoState({
        stage: "done",
        post: {
          title: post.title,
          scheduledAt: post.scheduledAt ?? null,
          content: post.content,
        },
      });
    } catch (err) {
      setAutoState({ stage: "error", message: String(err) });
    } finally {
      isGenerating.current = false;
    }
  };

  const openDialog = () => {
    setAutoState({ stage: "idle" });
    setAutoOpen(true);
  };

  const closeDialog = () => {
    setAutoOpen(false);
    setAutoState({ stage: "idle" });
  };

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* ── Боковая панель (только десктоп) ── */}
      <aside className="hidden md:flex w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border gap-2">
          <div className="bg-primary p-1.5 rounded-md text-primary-foreground">
            <Zap className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">Контент Фабрика</span>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-2 px-2 pt-2">
            <span className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
              VK Я-Инженер
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={openDialog}
              className="h-6 px-2 text-[11px] font-semibold gap-1 border-sidebar-foreground/20 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            >
              <Bot className="w-3 h-3" />
              Автомат
            </Button>
          </div>
          {ENGINEER_LINKS.map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{link.label}</span>
              </Link>
            );
          })}

          <div className="pt-4" />

          <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2 px-2">
            VK Безопасность всегда
          </div>
          {SECURITY_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <div
                key={link.label}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground/30 cursor-not-allowed select-none"
                title="Скоро"
              >
                <Icon className="w-5 h-5" />
                <span>{link.label}</span>
                <span className="ml-auto text-[10px] bg-sidebar-foreground/10 text-sidebar-foreground/40 px-1.5 py-0.5 rounded-full leading-none">
                  скоро
                </span>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── Основное содержимое ── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Шапка */}
        <div className="h-14 md:h-16 flex-shrink-0 border-b bg-card flex items-center px-4 md:px-8 shadow-sm z-10 relative gap-3">
          <div className="flex md:hidden items-center gap-2 shrink-0">
            <div className="bg-primary p-1 rounded-md text-primary-foreground">
              <Zap className="w-4 h-4" />
            </div>
          </div>

          <h1 className="font-medium text-base md:text-lg truncate">
            {location === "/" ? (
              <a
                href="https://vk.com/club238494545"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Я-Инженер
              </a>
            ) : (
              currentLabel
            )}
          </h1>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-8 pb-24 md:pb-8">
          {children}
        </div>
      </main>

      {/* ── Нижняя навигация (только мобильный) ── */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden bg-card border-t border-border z-50 safe-area-bottom">
        <div className="flex items-stretch h-16">
          {ENGINEER_LINKS.map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "stroke-[2.5]" : ""}`} />
                <span className="leading-none">
                  {link.label === "Рабочий стол" ? "Создать" : link.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Диалог Автомат ── */}
      <Dialog open={autoOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Автоматическая генерация
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {autoState.stage === "idle" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Программа сама просмотрит канал{" "}
                  <a
                    href="https://t.me/ieofficial"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    @ieofficial
                  </a>
                  , выберет подходящую тему и сгенерирует пост по правилам «Я-Инженер» — сразу запланирует на ближайший свободный день.
                </p>
                <Button onClick={() => void handleAutoGenerate()} className="w-full gap-2">
                  <Bot className="w-4 h-4" />
                  Сгенерировать
                </Button>
              </div>
            )}

            {autoState.stage === "loading" && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground text-center">
                  Читаю канал-источник, выбираю тему, пишу пост...
                  <br />
                  <span className="text-xs opacity-70">Обычно занимает 15–30 секунд</span>
                </p>
              </div>
            )}

            {autoState.stage === "done" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-3">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-green-800 dark:text-green-300 space-y-1">
                    <p className="font-medium">{autoState.post.title}</p>
                    {autoState.post.scheduledAt && (
                      <p className="flex items-center gap-1 text-xs opacity-80">
                        <CalendarIcon className="w-3 h-3" />
                        Запланировано на{" "}
                        {format(new Date(autoState.post.scheduledAt), "d MMMM yyyy", { locale: ru })}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-4 bg-muted/40 rounded p-2 font-mono leading-relaxed">
                  {autoState.post.content}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeDialog} className="flex-1">
                    Закрыть
                  </Button>
                  <Button onClick={() => setAutoState({ stage: "idle" })} variant="secondary" className="flex-1 gap-1">
                    <Bot className="w-3 h-3" />
                    Ещё один
                  </Button>
                </div>
              </div>
            )}

            {autoState.stage === "error" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800 dark:text-red-300">
                    {autoState.message}
                  </p>
                </div>
                <Button onClick={() => void handleAutoGenerate()} className="w-full gap-2">
                  Попробовать снова
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
