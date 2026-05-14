import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateOpenaiConversation, useCreatePost } from "@workspace/api-client-react";
import { Bot, Send, Save, ArrowRight, Loader2 } from "lucide-react";

export default function Home() {
  const [idea, setIdea] = useState("");
  const [feedback, setFeedback] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [, setLocation] = useLocation();

  const createConversation = useCreateOpenaiConversation();
  const createPost = useCreatePost();

  const handleGenerate = async () => {
    if (!idea.trim() || isGenerating) return;
    
    setIsGenerating(true);
    setAiResponse("");
    
    try {
      let currentConvId = conversationId;
      if (!currentConvId) {
        const conv = await createConversation.mutateAsync({
          data: { title: idea.slice(0, 50) }
        });
        currentConvId = conv.id;
        setConversationId(conv.id);
      }

      const response = await fetch(`/api/openai/conversations/${currentConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: idea }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const parsed = JSON.parse(line.slice(6));
          if (parsed.done) break;
          if (parsed.content) {
            setAiResponse(prev => prev + parsed.content);
          }
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImprove = async () => {
    if (!feedback.trim() || isGenerating || !conversationId) return;
    
    setIsGenerating(true);
    
    try {
      setAiResponse(prev => prev + "\n\n---\nУлучшаю...\n\n");
      const response = await fetch(`/api/openai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `Улучши пост с учетом этих замечаний: ${feedback}` }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const parsed = JSON.parse(line.slice(6));
          if (parsed.done) break;
          if (parsed.content) {
            setAiResponse(prev => prev + parsed.content);
          }
        }
      }
      setFeedback("");
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = async () => {
    if (!aiResponse) return;
    try {
      await createPost.mutateAsync({
        data: {
          title: idea.slice(0, 50) || "Новый пост",
          content: aiResponse,
          status: "draft",
          conversationId
        }
      });
      setLocation("/posts");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-[600px]">
      <div className="flex flex-col gap-6">
        <Card className="flex-1 flex flex-col border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <Bot className="w-4 h-4" />
              Новая идея для поста
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col">
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="О чем напишем сегодня? Например: Расскажи про новый мост в Китае, сделай упор на вантовые конструкции..."
              className="flex-1 resize-none border-0 focus-visible:ring-0 rounded-none p-6 text-base"
            />
            <div className="p-4 border-t bg-muted/10 flex justify-end">
              <Button onClick={handleGenerate} disabled={!idea.trim() || isGenerating} size="lg" className="w-full sm:w-auto">
                {isGenerating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
                Сгенерировать
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card className="flex-1 flex flex-col border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-4 border-b flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Результат
            </CardTitle>
            {aiResponse && (
              <Button onClick={handleAccept} size="sm" variant="secondary" className="h-8">
                <Save className="w-4 h-4 mr-2" />
                Принять пост
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-6 flex-1 overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed">
            {aiResponse ? (
              aiResponse
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground/50 text-center px-8">
                <div>
                  <Bot className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>Здесь появится сгенерированный текст.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-3 border-b">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Корректировка
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 flex gap-4">
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Что исправить? (Например: сделай тон более техническим)"
              className="resize-none h-20"
              disabled={!aiResponse || isGenerating}
            />
            <Button 
              onClick={handleImprove} 
              disabled={!feedback.trim() || !aiResponse || isGenerating} 
              className="h-20 px-6 shrink-0"
            >
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
