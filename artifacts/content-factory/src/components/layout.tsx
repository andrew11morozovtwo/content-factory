import { Link, useLocation } from "wouter";
import { PenSquare, CalendarDays, Library, Zap, Archive, Bot, Loader2, CheckCircle2, AlertTriangle, CalendarIcon, ShieldCheck, Cpu } from "lucide-react";
import { ReactNode, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getListPostsQueryKey,
  getGetAutopilotQueryKey,
  useGetAutopilot,
  useSetAutopilot,
  getGetBezAutopilotQueryKey,
  useGetBezAutopilot,
  useSetBezAutopilot,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const YI_LINKS = [
  { href: "/", label: "Рабочий стол", icon: PenSquare },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/posts", label: "Библиотека", icon: Library },
  { href: "/archive", label: "Архив", icon: Archive },
];

const BEZ_LINKS = [
  { href: "/bez", label: "Рабочий стол", icon: PenSquare },
  { href: "/bez/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/bez/posts", label: "Библиотека", icon: Library },
  { href: "/bez/archive", label: "Архив", icon: Archive },
];

type AutoState =
  | { stage: "idle" }
  | { stage: "loading" }
  | { stage: "done"; post: { title: string; scheduledAt: string | null; content: string } }
  | { stage: "error"; message: string };

function NavLink({ href, label, icon: Icon, isActive }: { href: string; label: string; icon: typeof PenSquare; isActive: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="text-sm">{label}</span>
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const queryClient = useQueryClient();

  // ── Я-Инженер Автомат ────────────────────────────────────────────────────────
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoState, setAutoState] = useState<AutoState>({ stage: "idle" });
  const isGenerating = useRef(false);

  // ── Безопасность Автомат ─────────────────────────────────────────────────────
  const [bezAutoOpen, setBezAutoOpen] = useState(false);
  const [bezAutoState, setBezAutoState] = useState<AutoState>({ stage: "idle" });
  const bezIsGenerating = useRef(false);

  // ── Autopilot hooks ──────────────────────────────────────────────────────────
  const { data: autopilot } = useGetAutopilot();
  const { mutate: setAutopilot, isPending: autopilotPending } = useSetAutopilot({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetAutopilotQueryKey() });
      },
    },
  });

  const { data: bezAutopilot } = useGetBezAutopilot();
  const { mutate: setBezAutopilot, isPending: bezAutopilotPending } = useSetBezAutopilot({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetBezAutopilotQueryKey() });
      },
    },
  });

  // ── Routing helpers ──────────────────────────────────────────────────────────
  const isBez = location.startsWith("/bez");
  const allLinks = isBez ? BEZ_LINKS : YI_LINKS;
  const currentLabel = allLinks.find((l) => l.href === location)?.label ?? "Контент Фабрика";

  // ── Я-Инженер auto-generate ──────────────────────────────────────────────────
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
      setAutoState({ stage: "done", post: { title: post.title, scheduledAt: post.scheduledAt ?? null, content: post.content } });
    } catch (err) {
      setAutoState({ stage: "error", message: String(err) });
    } finally {
      isGenerating.current = false;
    }
  };

  const openDialog = () => { setAutoState({ stage: "idle" }); setAutoOpen(true); };
  const closeDialog = () => { setAutoOpen(false); setAutoState({ stage: "idle" }); };

  // ── Безопасность auto-generate ───────────────────────────────────────────────
  const handleBezAutoGenerate = async () => {
    if (bezIsGenerating.current) return;
    bezIsGenerating.current = true;
    setBezAutoState({ stage: "loading" });
    try {
      const resp = await fetch("/api/bez-auto-generate", { method: "POST" });
      if (!resp.ok) {
        const err = (await resp.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const post = (await resp.json()) as { title: string; scheduledAt: string | null; content: string };
      await queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      setBezAutoState({ stage: "done", post: { title: post.title, scheduledAt: post.scheduledAt ?? null, content: post.content } });
    } catch (err) {
      setBezAutoState({ stage: "error", message: String(err) });
    } finally {
      bezIsGenerating.current = false;
    }
  };

  const openBezDialog = () => { setBezAutoState({ stage: "idle" }); setBezAutoOpen(true); };
  const closeBezDialog = () => { setBezAutoOpen(false); setBezAutoState({ stage: "idle" }); };

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* ── Боковая панель (только десктоп) ── */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex-col">
        {/* Логотип */}
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border gap-2">
          <div className="bg-primary p-1.5 rounded-md text-primary-foreground">
            <Zap className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm tracking-tight">Контент Фабрика</span>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto space-y-4">

          {/* ── VK Я-Инженер ── */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-sidebar-foreground/40" />
                <span className="text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  Я-Инженер
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={openDialog}
                className="h-5 px-1.5 text-[10px] font-semibold gap-1 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <Bot className="w-3 h-3" />
                Автомат
              </Button>
            </div>

            {/* Автопилот Я-Инженер */}
            <div className="flex items-center justify-between px-2 py-1.5 mb-1 rounded-md bg-sidebar-accent/20 border border-sidebar-border/50">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-semibold text-sidebar-foreground/60 leading-tight">
                  Автопилот
                </span>
                {autopilot?.nextRunAt && (
                  <span className="text-[9px] text-sidebar-foreground/40 leading-tight truncate">
                    след. {format(new Date(autopilot.nextRunAt), "HH:mm d MMM", { locale: ru })}
                  </span>
                )}
                {autopilot?.lastRunAt && (
                  <span className="text-[9px] text-sidebar-foreground/30 leading-tight truncate">
                    был {format(new Date(autopilot.lastRunAt), "d MMM HH:mm", { locale: ru })}
                  </span>
                )}
              </div>
              <Switch
                checked={autopilot?.enabled ?? false}
                disabled={autopilotPending}
                onCheckedChange={(checked) => setAutopilot({ data: { enabled: checked } })}
                className="shrink-0 scale-75"
              />
            </div>

            <div className="space-y-0.5">
              {YI_LINKS.map((link) => (
                <NavLink
                  key={link.href}
                  {...link}
                  isActive={location === link.href}
                />
              ))}
            </div>
          </div>

          {/* Разделитель */}
          <div className="border-t border-sidebar-border/60" />

          {/* ── VK Безопасность всегда ── */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1.5">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-sidebar-foreground/40" />
                <span className="text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  Безопасность
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={openBezDialog}
                className="h-5 px-1.5 text-[10px] font-semibold gap-1 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <Bot className="w-3 h-3" />
                Автомат
              </Button>
            </div>

            {/* Автопилот Безопасность */}
            <div className="flex items-center justify-between px-2 py-1.5 mb-1 rounded-md bg-sidebar-accent/20 border border-sidebar-border/50">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-semibold text-sidebar-foreground/60 leading-tight">
                  Автопилот
                </span>
                {bezAutopilot?.nextRunAt && (
                  <span className="text-[9px] text-sidebar-foreground/40 leading-tight truncate">
                    след. {format(new Date(bezAutopilot.nextRunAt), "HH:mm d MMM", { locale: ru })}
                  </span>
                )}
                {bezAutopilot?.lastRunAt && (
                  <span className="text-[9px] text-sidebar-foreground/30 leading-tight truncate">
                    был {format(new Date(bezAutopilot.lastRunAt), "d MMM HH:mm", { locale: ru })}
                  </span>
                )}
              </div>
              <Switch
                checked={bezAutopilot?.enabled ?? false}
                disabled={bezAutopilotPending}
                onCheckedChange={(checked) => setBezAutopilot({ data: { enabled: checked } })}
                className="shrink-0 scale-75"
              />
            </div>

            <div className="space-y-0.5">
              {BEZ_LINKS.map((link) => (
                <NavLink
                  key={link.href}
                  {...link}
                  isActive={location === link.href}
                />
              ))}
            </div>
          </div>
        </nav>
      </aside>

      {/* ── Основное содержимое ── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Шапка */}
        <div className="h-14 flex-shrink-0 border-b bg-card flex items-center px-4 md:px-6 shadow-sm z-10 relative gap-3">
          <div className="flex md:hidden items-center gap-2 shrink-0">
            <div className="bg-primary p-1 rounded-md text-primary-foreground">
              <Zap className="w-4 h-4" />
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            {isBez ? (
              <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Cpu className="w-4 h-4 text-blue-500 shrink-0" />
            )}
            <h1 className="font-medium text-base truncate">
              {isBez ? (
                <a
                  href="https://vk.com/bezopasnost_vsegda"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-600 hover:underline dark:text-amber-400"
                >
                  Безопасность всегда
                </a>
              ) : location === "/" ? (
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
            {currentLabel !== "Рабочий стол" && (
              <span className="text-muted-foreground/40 text-sm hidden sm:inline">/ {currentLabel}</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-6 pb-24 md:pb-6">
          {children}
        </div>
      </main>

      {/* ── Нижняя навигация (только мобильный) ── */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden bg-card border-t border-border z-50 safe-area-bottom">
        <div className="flex items-stretch h-14">
          {(isBez ? BEZ_LINKS : YI_LINKS).map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[9px] font-medium transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "stroke-[2.5]" : ""}`} />
                <span className="leading-none">
                  {link.label === "Рабочий стол" ? "Создать" : link.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Диалог Автомат — Я-Инженер ── */}
      <Dialog open={autoOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Автоматическая генерация — Я-Инженер
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

      {/* ── Диалог Автомат — Безопасность всегда ── */}
      <Dialog open={bezAutoOpen} onOpenChange={(o) => !o && closeBezDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-500" />
              Автоматическая генерация — Безопасность
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {bezAutoState.stage === "idle" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  AI сам выберет актуальную тему безопасности (с учётом сезона и времени года) и напишет короткий пост для канала «Безопасность всегда» — сразу запланирует на ближайший свободный день.
                </p>
                <Button onClick={() => void handleBezAutoGenerate()} className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-white">
                  <Bot className="w-4 h-4" />
                  Сгенерировать
                </Button>
              </div>
            )}

            {bezAutoState.stage === "loading" && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                <p className="text-sm text-muted-foreground text-center">
                  Выбираю тему безопасности, пишу пост...
                  <br />
                  <span className="text-xs opacity-70">Обычно занимает 10–20 секунд</span>
                </p>
              </div>
            )}

            {bezAutoState.stage === "done" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-3">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-green-800 dark:text-green-300 space-y-1">
                    <p className="font-medium">{bezAutoState.post.title}</p>
                    {bezAutoState.post.scheduledAt && (
                      <p className="flex items-center gap-1 text-xs opacity-80">
                        <CalendarIcon className="w-3 h-3" />
                        Запланировано на{" "}
                        {format(new Date(bezAutoState.post.scheduledAt), "d MMMM yyyy", { locale: ru })}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-4 bg-muted/40 rounded p-2 font-mono leading-relaxed">
                  {bezAutoState.post.content}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeBezDialog} className="flex-1">
                    Закрыть
                  </Button>
                  <Button onClick={() => setBezAutoState({ stage: "idle" })} variant="secondary" className="flex-1 gap-1">
                    <Bot className="w-3 h-3" />
                    Ещё один
                  </Button>
                </div>
              </div>
            )}

            {bezAutoState.stage === "error" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800 dark:text-red-300">
                    {bezAutoState.message}
                  </p>
                </div>
                <Button onClick={() => void handleBezAutoGenerate()} className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-white">
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
