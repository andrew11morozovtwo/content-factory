import { useListPosts, useGetPostStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon, Clock, CheckCircle2, FileEdit } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export default function Calendar() {
  const { data: posts, isLoading } = useListPosts();
  const { data: stats } = useGetPostStats();

  const scheduledPosts = posts?.filter(p => p.status === "scheduled" && p.scheduledAt) || [];

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
          ) : scheduledPosts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
              Нет запланированных постов
            </div>
          ) : (
            <div className="space-y-4">
              {scheduledPosts.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime()).map(post => (
                <div key={post.id} className="flex items-start gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                  <div className="flex flex-col items-center justify-center w-16 h-16 bg-primary/10 text-primary rounded-md shrink-0">
                    <span className="text-xs uppercase font-medium opacity-70">{format(new Date(post.scheduledAt!), "EEE", { locale: ru })}</span>
                    <span className="text-lg font-bold leading-tight">{format(new Date(post.scheduledAt!), "d", { locale: ru })}</span>
                    <span className="text-xs uppercase">{format(new Date(post.scheduledAt!), "MMM", { locale: ru })}</span>
                  </div>
                  <div>
                    <h3 className="font-medium line-clamp-1">{post.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {format(new Date(post.scheduledAt!), "HH:mm", { locale: ru })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
