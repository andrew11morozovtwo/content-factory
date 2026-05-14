import { useState } from "react";
import { useListPosts, useDeletePost, getListPostsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Trash2, Edit2, Plus } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const STATUS_MAP = {
  draft: { label: "Черновик", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
  scheduled: { label: "Запланирован", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  published: { label: "Опубликован", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  rejected: { label: "Отклонен", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

export default function Posts() {
  const { data: posts, isLoading } = useListPosts();
  const deletePost = useDeletePost();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const filteredPosts = posts?.filter(post => 
    post.title.toLowerCase().includes(search.toLowerCase()) || 
    post.content.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleDelete = async (id: number) => {
    if (confirm("Точно удалить пост?")) {
      await deletePost.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
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
          filteredPosts.map(post => (
            <Card key={post.id} className="group overflow-hidden">
              <div className="flex flex-col sm:flex-row">
                <div className="p-6 flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge variant="secondary" className={STATUS_MAP[post.status as keyof typeof STATUS_MAP].color + " border-none"}>
                      {STATUS_MAP[post.status as keyof typeof STATUS_MAP].label}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(post.createdAt), "d MMMM yyyy", { locale: ru })}
                    </span>
                  </div>
                  <h3 className="font-semibold text-lg mb-2 line-clamp-1">{post.title}</h3>
                  <p className="text-muted-foreground text-sm line-clamp-2">{post.content}</p>
                </div>
                <div className="bg-muted/30 p-4 sm:border-l flex flex-row sm:flex-col items-center justify-center gap-2">
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => handleDelete(post.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

import { Library } from "lucide-react";
