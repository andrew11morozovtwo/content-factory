import { Link, useLocation } from "wouter";
import { PenSquare, CalendarDays, Library, Zap, Archive } from "lucide-react";
import { ReactNode } from "react";

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

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const allLinks = [...ENGINEER_LINKS, { href: "/archive", label: "Архив", icon: Archive }];
  const currentLabel =
    ENGINEER_LINKS.find((l) => l.href === location)?.label ?? "Контент Фабрика";

  return (
    <div className="flex min-h-[100dvh] bg-background">
      <aside className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border gap-2">
          <div className="bg-primary p-1.5 rounded-md text-primary-foreground">
            <Zap className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">Контент Фабрика</span>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {/* ── Канал 1: VK Я-Инженер ── */}
          <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2 px-2 pt-2">
            VK Я-Инженер
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

          {/* ── Разделитель ── */}
          <div className="pt-4" />

          {/* ── Канал 2: VK Безопасность всегда ── */}
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

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="h-16 flex-shrink-0 border-b bg-card flex items-center px-8 shadow-sm z-10 relative">
          <h1 className="font-medium text-lg">
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
        <div className="flex-1 overflow-auto p-8">{children}</div>
      </main>
    </div>
  );
}
