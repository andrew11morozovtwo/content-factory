import { Link, useLocation } from "wouter";
import { PenSquare, CalendarDays, Library, Zap, Archive, Bot, Loader2, CheckCircle2, AlertTriangle, CalendarIcon, ShieldCheck, Cpu, FileText, Download } from "lucide-react";
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
  getGetBezPlanQueryKey,
  useGetBezPlan,
  useGenerateBezPlan,
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

// ─── Plan formatting helpers ──────────────────────────────────────────────────

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split("-");
  return `${parts[2]}.${parts[1]}`;
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  return `${formatShortDate(weekStart)}–${formatShortDate(weekEnd)}`;
}

function planToText(plan: { weeks: Array<{ weekStart: string; weekEnd: string; theme: string; days: Array<{ date: string; topic: string }> }> }): string {
  const DAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  return plan.weeks
    .map((week) => {
      const header = `${formatWeekLabel(week.weekStart, week.weekEnd)} — ${week.theme}`;
      const days = week.days
        .map((d) => {
          const dayName = DAY_SHORT[new Date(`${d.date}T12:00:00`).getDay()] ?? "";
          return `• ${formatShortDate(d.date)} (${dayName}) — ${d.topic}`;
        })
        .join("\n");
      return `${header}\n${days}`;
    })
    .join("\n\n" + "─".repeat(60) + "\n\n");
}

// ─── Main Layout ──────────────────────────────────────────────────────────────

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

  // ── Безопасность План ────────────────────────────────────────────────────────
  const [bezPlanOpen, setBezPlanOpen] = useState(false);

  // ── Autopilot / Plan hooks ───────────────────────────────────────────────────
  const { data: autopilot } = useGetAutopilot();
  const { mutate: setAutopilot, isPending: autopilotPending } = useSetAutopilot({
    mutation: {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetAutopilotQueryKey() }),
    },
  });

  const { data: bezAutopilot } = useGetBezAutopilot();
  const { mutate: setBezAutopilot, isPending: bezAutopilotPending } = useSetBezAutopilot({
    mutation: {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetBezAutopilotQueryKey() }),
    },
  });

  const { data: bezPlan } = useGetBezPlan();
  const { mutate: doGenerateBezPlan, isPending: bezPlanGenerating } = useGenerateBezPlan({
    mutation: {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetBezPlanQueryKey() }),
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

  // ── Безопасность plan download ───────────────────────────────────────────────
  const handleDownloadPlan = () => {
    if (!bezPlan || !bezPlan.weeks?.length) return;
    const text = planToText(bezPlan as { weeks: Array<{ weekStart: string; weekEnd: string; theme: string; days: Array<{ date: string; topic: string }> }> });
    const header = `ПЛАН ПУБЛИКАЦИЙ — Безопасность всегда\nПериод: ${bezPlan.startDate ?? ""} — ${bezPlan.endDate ?? ""}\nСоздан: ${bezPlan.generatedAt ? format(new Date(bezPlan.generatedAt), "d MMMM yyyy HH:mm", { locale: ru }) : ""}\n\n${"═".repeat(60)}\n\n`;
    const blob = new Blob([header + text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bez-plan-${bezPlan.startDate ?? "draft"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasPlan = !!bezPlan?.generatedAt && (bezPlan.weeks?.length ?? 0) > 0;

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
                <NavLink key={link.href} {...link} isActive={location === link.href} />
              ))}
            </div>
          </div>

          {/* Разделитель */}
          <div className="border-t border-sidebar-border/60" />

          {/* ── VK Безопасность всегда ── */}
          <div>
            <div className="px-2 mb-1.5 space-y-1">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-sidebar-foreground/40" />
                <span className="text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  Безопасность
                </span>
              </div>
              {/* Кнопки на второй строке */}
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={openBezDialog}
                  className="h-5 px-1.5 text-[10px] font-semibold gap-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                >
                  <Bot className="w-3 h-3" />
                  Автомат
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBezPlanOpen(true)}
                  className={`h-5 px-1.5 text-[10px] font-semibold gap-0.5 hover:bg-sidebar-accent/50 ${
                    hasPlan
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-sidebar-foreground/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  План
                </Button>
              </div>
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
                <NavLink key={link.href} {...link} isActive={location === link.href} />
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
                <a href="https://vk.com/bezopasnost_vsegda" target="_blank" rel="noopener noreferrer"
                  className="text-amber-600 hover:underline dark:text-amber-400">
                  Безопасность всегда
                </a>
              ) : location === "/" ? (
                <a href="https://vk.com/club238494545" target="_blank" rel="noopener noreferrer"
                  className="text-primary hover:underline">
                  Я-Инженер
                </a>
              ) : currentLabel}
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
              <Link key={link.href} href={link.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[9px] font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "stroke-[2.5]" : ""}`} />
                <span className="leading-none">{link.label === "Рабочий стол" ? "Создать" : link.label}</span>
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
                  <a href="https://t.me/ieofficial" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
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
                  Читаю канал-источник, выбираю тему, пишу пост...<br />
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
                        Запланировано на {format(new Date(autoState.post.scheduledAt), "d MMMM yyyy", { locale: ru })}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-4 bg-muted/40 rounded p-2 font-mono leading-relaxed">
                  {autoState.post.content}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeDialog} className="flex-1">Закрыть</Button>
                  <Button onClick={() => setAutoState({ stage: "idle" })} variant="secondary" className="flex-1 gap-1">
                    <Bot className="w-3 h-3" />Ещё один
                  </Button>
                </div>
              </div>
            )}
            {autoState.stage === "error" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800 dark:text-red-300">{autoState.message}</p>
                </div>
                <Button onClick={() => void handleAutoGenerate()} className="w-full gap-2">Попробовать снова</Button>
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
                  AI возьмёт тему из плана публикаций (если план создан) или сам выберет актуальную тему безопасности с учётом сезона и напишет пост для канала «Безопасность всегда».
                </p>
                {hasPlan && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 flex items-center gap-2">
                    <FileText className="w-3 h-3 shrink-0" />
                    План публикаций подключён — AI возьмёт тему на сегодня из плана
                  </div>
                )}
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
                  Выбираю тему безопасности, пишу пост...<br />
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
                        Запланировано на {format(new Date(bezAutoState.post.scheduledAt), "d MMMM yyyy", { locale: ru })}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-4 bg-muted/40 rounded p-2 font-mono leading-relaxed">
                  {bezAutoState.post.content}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeBezDialog} className="flex-1">Закрыть</Button>
                  <Button onClick={() => setBezAutoState({ stage: "idle" })} variant="secondary" className="flex-1 gap-1">
                    <Bot className="w-3 h-3" />Ещё один
                  </Button>
                </div>
              </div>
            )}
            {bezAutoState.stage === "error" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800 dark:text-red-300">{bezAutoState.message}</p>
                </div>
                <Button onClick={() => void handleBezAutoGenerate()} className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-white">
                  Попробовать снова
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Диалог План публикаций — Безопасность всегда ── */}
      <Dialog open={bezPlanOpen} onOpenChange={(o) => { if (!o && !bezPlanGenerating) setBezPlanOpen(false); }}>
        <DialogContent className="max-w-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-500" />
              План публикаций — Безопасность всегда
            </DialogTitle>
          </DialogHeader>

          {bezPlanGenerating && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Генерирую план на 3 месяца...</p>
                <p className="text-xs text-muted-foreground">AI разрабатывает темы с учётом сезонности и архива публикаций</p>
                <p className="text-xs text-muted-foreground opacity-60">Обычно занимает 30–60 секунд</p>
              </div>
            </div>
          )}

          {!bezPlanGenerating && !hasPlan && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-4 space-y-2">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-300">Что даёт план публикаций?</p>
                <ul className="text-sm text-amber-800 dark:text-amber-400 space-y-1">
                  <li>• 13 недель конкретных тем (≈ 91 пост) с учётом сезона</li>
                  <li>• Темы не повторяются — AI учитывает архив последних 6 месяцев</li>
                  <li>• Автопилот и Автомат берут тему на сегодня прямо из плана</li>
                  <li>• Можно скачать как текстовый документ</li>
                </ul>
              </div>
              <Button
                onClick={() => doGenerateBezPlan()}
                className="w-full gap-2 bg-amber-500 hover:bg-amber-600 text-white"
              >
                <FileText className="w-4 h-4" />
                Сгенерировать план на 3 месяца
              </Button>
            </div>
          )}

          {!bezPlanGenerating && hasPlan && bezPlan && (
            <>
              {/* Meta info */}
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
                <span>
                  Создан: {bezPlan.generatedAt ? format(new Date(bezPlan.generatedAt), "d MMM yyyy, HH:mm", { locale: ru }) : "—"}
                </span>
                <span className="font-medium text-foreground/60">
                  {bezPlan.startDate} — {bezPlan.endDate} · {bezPlan.weeks?.length ?? 0} нед.
                </span>
              </div>

              {/* Plan content — scrollable */}
              <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
                {(bezPlan.weeks ?? []).map((week, wi) => (
                  <div key={wi} className="space-y-1">
                    <p className="text-[11px] font-bold text-foreground/80 uppercase tracking-wide">
                      {formatWeekLabel(week.weekStart, week.weekEnd)} — {week.theme}
                    </p>
                    {week.days.map((day, di) => {
                      const dayObj = new Date(`${day.date}T12:00:00`);
                      const isWeekend = dayObj.getDay() === 6 || dayObj.getDay() === 0;
                      return (
                        <p
                          key={di}
                          className={`text-xs pl-3 leading-relaxed ${
                            isWeekend
                              ? "text-muted-foreground/50 italic"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="text-foreground/50 font-mono mr-1">{formatShortDate(day.date)}</span>
                          {day.topic}
                        </p>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={handleDownloadPlan}
                  className="gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Скачать .txt
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => doGenerateBezPlan()}
                  className="flex-1 gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Обновить план
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
