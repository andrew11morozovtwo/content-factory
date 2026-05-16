import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateOpenaiConversation, useCreatePost } from "@workspace/api-client-react";
import { Bot, Send, Save, ArrowRight, Loader2 } from "lucide-react";

const DAYS = [
  { label: "Пн", index: 1 },
  { label: "Вт", index: 2 },
  { label: "Ср", index: 3 },
  { label: "Чт", index: 4 },
  { label: "Пт", index: 5 },
  { label: "Сб", index: 6 },
  { label: "Вс", index: 0 },
];

const DAYS_RU_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];


export default function Home() {
  const [idea, setIdea] = useState("");
  const [feedback, setFeedback] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const todayIndex = new Date().getDay();
  const [selectedDay, setSelectedDay] = useState<number>(todayIndex);
  const [recommendedDay, setRecommendedDay] = useState<number>(todayIndex);
  const [, setLocation] = useLocation();

  const createConversation = useCreateOpenaiConversation();
  const createPost = useCreatePost();

  const readSSEStream = async (
    response: Response,
    onContent: (chunk: string) => void,
    onDay?: (day: number) => void,
    onStep?: (step: string) => void,
    onError?: (msg: string) => void,
    onCorrected?: (text: string) => void,
  ) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.step !== undefined && onStep) onStep(parsed.step);
          if (parsed.day !== undefined && onDay) onDay(parsed.day);
          if (parsed.content) onContent(parsed.content);
          if (parsed.corrected !== undefined && onCorrected) onCorrected(parsed.corrected);
          if (parsed.error && onError) onError(parsed.error);
          if (parsed.done) { finished = true; }
        } catch {
          // skip malformed lines
        }
      }
    }
  };

  const handleGenerate = async () => {
    if (!idea.trim() || isGenerating) return;

    setIsGenerating(true);
    setAiResponse("");
    setCurrentStep(null);
    setErrorMessage(null);
    setSelectedDay(todayIndex);
    setRecommendedDay(todayIndex);

    try {
      let currentConvId = conversationId;
      if (!currentConvId) {
        const conv = await createConversation.mutateAsync({
          data: { title: idea.slice(0, 50) },
        });
        currentConvId = conv.id;
        setConversationId(conv.id);
      }

      const response = await fetch(`/api/openai/conversations/${currentConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: idea }),
      });

      await readSSEStream(
        response,
        (chunk) => {
          setCurrentStep(null);
          setAiResponse((prev) => prev + chunk);
        },
        (day) => {
          setRecommendedDay(day);
          setSelectedDay(day);
        },
        (step) => {
          setCurrentStep(step);
        },
        (msg) => {
          setErrorMessage(msg);
        },
        (text) => {
          setAiResponse(text);
        },
      );
    } catch (error) {
      console.error(error);
      setErrorMessage("Не удалось подключиться к серверу. Попробуйте ещё раз.");
    } finally {
      setIsGenerating(false);
      setCurrentStep(null);
    }
  };

  const handleImprove = async () => {
    if (!feedback.trim() || isGenerating || !conversationId) return;

    setIsGenerating(true);
    setCurrentStep(null);
    setErrorMessage(null);

    try {
      const dayNote = `пост для ${DAYS_RU_FULL[selectedDay]}`;
      const content = `Улучши пост (${dayNote}) с учётом замечаний: ${feedback}`;

      setAiResponse("");

      const response = await fetch(`/api/openai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      await readSSEStream(
        response,
        (chunk) => {
          setCurrentStep(null);
          setAiResponse((prev) => prev + chunk);
        },
        undefined,
        (step) => setCurrentStep(step),
        (msg) => setErrorMessage(msg),
        (text) => setAiResponse(text),
      );

      setFeedback("");
    } catch (error) {
      console.error(error);
      setErrorMessage("Не удалось подключиться к серверу. Попробуйте ещё раз.");
    } finally {
      setIsGenerating(false);
      setCurrentStep(null);
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
          conversationId,
        },
      });
      setLocation("/posts");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-[600px]">
      {/* LEFT COLUMN */}
      <div className="flex flex-col gap-4">
        {/* Idea input */}
        <Card className="flex flex-col border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <Bot className="w-4 h-4" />
              Новая идея для поста
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex flex-col">
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="О чем напишем сегодня? Например: Расскажи про новый мост в Китае, сделай упор на вантовые конструкции..."
              className="resize-none border-0 focus-visible:ring-0 rounded-none p-6 text-base min-h-[200px]"
              data-testid="input-idea"
            />
            <div className="p-4 border-t bg-muted/10">
              <Button
                onClick={handleGenerate}
                disabled={!idea.trim() || isGenerating}
                size="lg"
                className="w-full"
                data-testid="button-generate"
              >
                {isGenerating ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <Send className="w-5 h-5 mr-2" />
                )}
                Сгенерировать
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Day selector */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-3 border-b">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              День публикации
              {recommendedDay !== null && (
                <span className="ml-2 text-xs text-primary font-normal">
                  — рекомендован {DAYS.find((d) => d.index === recommendedDay)?.label}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-7 gap-1.5">
              {DAYS.map((day) => {
                const isSelected = selectedDay === day.index;
                const isRecommended = recommendedDay === day.index;
                return (
                  <Button
                    key={day.index}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDay(day.index)}
                    className={`flex flex-col h-auto py-2 px-1 text-xs font-medium transition-all ${
                      isSelected && isRecommended
                        ? "ring-2 ring-primary ring-offset-1"
                        : ""
                    }`}
                    data-testid={`button-day-${day.label.toLowerCase()}`}
                  >
                    <span>{day.label}</span>
                    {isRecommended && !isSelected && (
                      <span className="w-1 h-1 rounded-full bg-primary mt-1" />
                    )}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Feedback / correction */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-3 border-b">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Корректировка
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 flex gap-3">
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Что исправить? (Например: сделай тон более техническим)"
              className="resize-none h-20"
              disabled={!aiResponse || isGenerating}
              data-testid="input-feedback"
            />
            <Button
              onClick={handleImprove}
              disabled={!feedback.trim() || !aiResponse || isGenerating}
              className="h-20 px-5 shrink-0"
              data-testid="button-improve"
            >
              {isGenerating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ArrowRight className="w-5 h-5" />
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* RIGHT COLUMN */}
      <div className="flex flex-col">
        <Card className="flex-1 flex flex-col border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-4 border-b flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Результат
            </CardTitle>
            {aiResponse && !isGenerating && (
              <Button
                onClick={handleAccept}
                size="sm"
                variant="secondary"
                className="h-8"
                data-testid="button-accept-post"
              >
                <Save className="w-4 h-4 mr-2" />
                Принять пост
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-6 flex-1 overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed">
            {errorMessage ? (
              <div className="h-full flex items-center justify-center text-center px-8">
                <div>
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
                    <span className="text-destructive text-xl font-bold">!</span>
                  </div>
                  <p className="text-destructive font-medium mb-1">Ошибка генерации</p>
                  <p className="text-sm text-muted-foreground">{errorMessage}</p>
                </div>
              </div>
            ) : aiResponse ? (
              aiResponse
            ) : currentStep ? (
              <div className="h-full flex items-center justify-center text-center px-8">
                <div>
                  <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-primary/60" />
                  <p className="text-sm text-muted-foreground">{currentStep}</p>
                </div>
              </div>
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
      </div>
    </div>
  );
}
