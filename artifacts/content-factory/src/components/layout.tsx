import { Link, useLocation } from "wouter";
import { PenSquare, CalendarDays, Library, Zap, Archive } from "lucide-react";
import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Рабочий стол", icon: PenSquare },
    { href: "/calendar", label: "Календарь", icon: CalendarDays },
    { href: "/posts", label: "Библиотека", icon: Library },
    { href: "/archive", label: "Архив", icon: Archive },
  ];

  return (
    <div className="flex min-h-[100dvh] bg-background">
      <aside className="w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border gap-2">
          <div className="bg-primary p-1.5 rounded-md text-primary-foreground">
            <Zap className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">Контент Фабрика</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-4 px-2">
            Навигация
          </div>
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href;
            return (
              <Link key={link.href} href={link.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}>
                <Icon className="w-5 h-5" />
                <span>{link.label}</span>
              </Link>
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
              links.find(l => l.href === location)?.label || "Контент Фабрика"
            )}
          </h1>
        </div>
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
