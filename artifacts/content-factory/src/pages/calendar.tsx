import { useListPosts, useGetPostStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon, Clock, CheckCircle2, FileEdit } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export default function Calendar() {
  const { data: posts, isLoading } = useListPosts();
  const { data: stats } = useGetPostStats();

  const scheduledPosts = posts?.filter(p => p.status === "scheduled" && p.scheduledAt) || [];

  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Черновики</CardTitle>
            <FileEdit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.draft || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Запланировано</CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.scheduled || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Опубликовано</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.published || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего</CardTitle>
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ближайшие публикации</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Загрузка...</div>
          ) : (
            <div className="space-y-3">
              {next7Days.map(day => {
                const dayPosts = scheduledPosts.filter(p => {
                  const d = new Date(p.scheduledAt!);
                  return d.getFullYear() === day.getFullYear() &&
                    d.getMonth() === day.getMonth() &&
                    d.getDate() === day.getDate();
                });
                const isToday = day.toDateString() === new Date().toDateString();
                return (
                  <div key={day.toISOString()} className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${isToday ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50"}`}>
                    <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-md shrink-0 ${isToday ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      <span className="text-xs uppercase font-medium opacity-80">{format(day, "EEE", { locale: ru })}</span>
                      <span className="text-lg font-bold leading-tight">{format(day, "d", { locale: ru })}</span>
                      <span className="text-xs uppercase">{format(day, "MMM", { locale: ru })}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      {dayPosts.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic mt-1">Публикаций нет</p>
                      ) : (
                        <div className="space-y-2">
                          {dayPosts.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()).map(post => (
                            <div key={post.id} className="flex items-center gap-3">
                              <span className="text-sm text-muted-foreground shrink-0">{format(new Date(post.scheduledAt!), "HH:mm", { locale: ru })}</span>
                              <span className="font-medium text-sm truncate">{post.title}</span>
                            </div>
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
