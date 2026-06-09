import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateOpenaiConversation, useCreatePost, useListPosts } from "@workspace/api-client-react";
import { isSameDay } from "date-fns";
import { Bot, Send, Save, ArrowRight, Loader2, Calendar, Wand2, Copy, Check as CheckIcon, Download, ImageIcon } from "lucide-react";

const DAYS = [
  { label: "Пн", index: 1 },
  { label: "Вт", index: 2 },
  { label: "Ср", index: 3 },
  { label: "Чт", index: 4 },
  { label: "Пт", index: 5 },
  { label: "Сб", index: 6 },
  { label: "Вс", index: 0 },
];

type Channel = "ya-inzhener" | "bezopasnost";

interface Props {
  channel: Channel;
}

export default function Home({ channel }: Props) {
  const [idea, setIdea] = useState("");
  const [feedback, setFeedback] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [imagePrompt, setImagePrompt] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const todayIndex = new Date().getDay();
  const [selectedDay, setSelectedDay] = useState<number>(todayIndex);
  const [recommendedDay, setRecommendedDay] = useState<number | null>(null);
  const [userPickedDay, setUserPickedDay] = useState(false);
  const [, setLocation] = useLocation();
  const { data: posts } = useListPosts();

  const createConversation = useCreateOpenaiConversation();
  const createPost = useCreatePost();

  const isBez = channel === "bezopasnost";
  const calendarPath = isBez ? "/bez/calendar" : "/calendar";
  const postsPath = isBez ? "/bez/posts" : "/posts";

  const readSSEStream = async (
    response: Response,
    onContent: (chunk: string) => void,
    onDay?: (day: number) => void,
    onStep?: (step: string) => void,
    onError?: (msg: string) => void,
    onCorrected?: (text: string) => void,
    onImagePrompt?: (prompt: string) => void,
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
          if (parsed.imagePrompt && onImagePrompt) onImagePrompt(parsed.imagePrompt as string);
          if (parsed.error && onError) onError(parsed.error);
          if (parsed.done) { finished = true; }
        } catch {
          // skip malformed lines
        }
      }
    }
  };

  const generateImage = async (prompt: string) => {
    setIsGeneratingImage(true);
    setImageError(null);
    try {
      const res = await fetch("/api/openai/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { imageUrl?: string };
      if (data.imageUrl) setImageUrl(data.imageUrl);
      else setImageError("Картинка не получена от модели.");
    } catch {
      setImageError("Не удалось сгенерировать иллюстрацию.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleGenerate = async () => {
    if (!idea.trim() || isGenerating) return;

    setIsGenerating(true);
    setAiResponse("");
    setCurrentStep(null);
    setErrorMessage(null);
    setImagePrompt(null);
    setImageUrl(null);
    setImageError(null);
    setCopied(false);
    setSelectedDay(todayIndex);
    setRecommendedDay(null);
    setUserPickedDay(false);

    let capturedPrompt: string | null = null;

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
        headers: { "Content-Type": "application/json", "X-Channel": channel },
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
          setUserPickedDay((picked) => {
            if (!picked) setSelectedDay(day);
            return picked;
          });
        },
        (step) => setCurrentStep(step),
        (msg) => setErrorMessage(msg),
        (text) => setAiResponse(text),
        (prompt) => { setImagePrompt(prompt); capturedPrompt = prompt; },
      );
    } catch (error) {
      console.error(error);
      setErrorMessage("Не удалось подключиться к серверу. Попробуйте ещё раз.");
    } finally {
      setIsGenerating(false);
      setCurrentStep(null);
    }

    if (isBez && capturedPrompt) {
      void generateImage(capturedPrompt);
    }
  };

  const handleImprove = async () => {
    if (!feedback.trim() || isGenerating || !conversationId) return;

    setIsGenerating(true);
    setCurrentStep(null);
    setErrorMessage(null);
    setImagePrompt(null);
    setImageUrl(null);
    setImageError(null);
    setCopied(false);

    let capturedPrompt: string | null = null;

    try {
      const dayNote = DAYS.find((d) => d.index === selectedDay)?.label ?? "";
      const content = `Улучши пост (${dayNote}) с учётом замечаний: ${feedback}`;

      setAiResponse("");

      const response = await fetch(`/api/openai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Channel": channel },
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
        (prompt) => { setImagePrompt(prompt); capturedPrompt = prompt; },
      );

      setFeedback("");
    } catch (error) {
      console.error(error);
      setErrorMessage("Не удалось подключиться к серверу.");
    } finally {
      setIsGenerating(false);
      setCurrentStep(null);
    }

    if (isBez && capturedPrompt) {
      void generateImage(capturedPrompt);
    }
  };

  const occupiedDates: Date[] = (posts ?? [])
    .filter((p) => p.status === "scheduled" && p.scheduledAt && p.channel === channel)
    .map((p) => new Date(p.scheduledAt!));

  const getNextFreeDateForDay = (dayIndex: number): Date => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const currentDay = today.getDay();
    let daysUntil = (dayIndex - currentDay + 7) % 7;
    if (daysUntil === 0) daysUntil = 0;

    const candidate = new Date(today);
    candidate.setDate(today.getDate() + daysUntil);

    for (let week = 0; week < 52; week++) {
      const isOccupied = occupiedDates.some((d) => isSameDay(d, candidate));
      if (!isOccupied) return new Date(candidate);
      candidate.setDate(candidate.getDate() + 7);
    }

    return candidate;
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
          recommendedDay: selectedDay,
          channel,
          // @ts-expect-error illustrationUrl not in generated OpenAPI type — stored in DB at creation
          illustrationUrl: isBez ? imageUrl : null,
        },
      });
      setLocation(postsPath);
    } catch (err) {
      console.error(err);
    }
  };

  const handleScheduleNow = async () => {
    if (!aiResponse || isPublishing) return;
    setIsPublishing(true);
    try {
      // DEBUG: немедленная публикация (без планировщика)
      const post = await createPost.mutateAsync({
        data: {
          title: idea.slice(0, 50) || "Новый пост",
          content: aiResponse,
          status: "draft",
          conversationId,
          recommendedDay: selectedDay,
          channel,
          // @ts-expect-error illustrationUrl not in generated OpenAPI type — stored in DB at creation
          illustrationUrl: isBez ? imageUrl : null,
        },
      });
      await fetch(`/api/posts/${post.id}/publish`, { method: "POST" });
      setLocation(postsPath);

      // ORIGINAL: планирование на ближайший свободный слот
      // const scheduledAt = getNextFreeDateForDay(selectedDay);
      // await createPost.mutateAsync({
      //   data: {
      //     title: idea.slice(0, 50) || "Новый пост",
      //     content: aiResponse,
      //     status: "scheduled",
      //     conversationId,
      //     recommendedDay: selectedDay,
      //     scheduledAt: scheduledAt.toISOString(),
      //     channel,
      //   },
      // });
      // setLocation(calendarPath);
    } catch (err) {
      console.error(err);
    } finally {
      setIsPublishing(false);
    }
  };

  const placeholder = isBez
    ? "О чем напишем сегодня? Например: Безопасность на воде летом — что нужно знать..."
    : "О чем напишем сегодня? Например: Расскажи про новый мост в Китае, сделай упор на вантовые конструкции...";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[600px] lg:h-full">
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
              placeholder={placeholder}
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
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-1">
              День публикации
              {userPickedDay && recommendedDay !== null && recommendedDay !== selectedDay && (
                <span className="text-xs text-muted-foreground/70 font-normal">
                  (AI рекомендовал {DAYS.find((d) => d.index === recommendedDay)?.label})
                </span>
              )}
              {!userPickedDay && recommendedDay !== null && (
                <span className="text-xs text-primary font-normal">
                  — AI рекомендует {DAYS.find((d) => d.index === recommendedDay)?.label}
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
                    onClick={() => {
                      setSelectedDay(day.index);
                      setUserPickedDay(true);
                    }}
                    className={`flex flex-col h-auto py-2 px-1 text-xs font-medium transition-all ${
                      isRecommended && !isSelected
                        ? "border-primary/50 text-primary"
                        : ""
                    } ${
                      isSelected && isRecommended && !userPickedDay
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
              placeholder="Что исправить? (Например: сделай тон более дружелюбным)"
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
      <div className="flex flex-col gap-4">
        <Card className="flex-1 flex flex-col border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 pb-4 border-b flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground shrink-0">
              Результат
            </CardTitle>
            {aiResponse && !isGenerating && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleScheduleNow}
                  size="sm"
                  disabled={isPublishing}
                  className="h-8 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-100 disabled:bg-amber-500 disabled:text-white transition-colors"
                  data-testid="button-schedule-now"
                >
                  {isPublishing ? (
                    <>
                      <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                      </svg>
                      Публикую…
                    </>
                  ) : (
                    <>
                      <Calendar className="w-4 h-4 mr-2" />
                      В публикацию
                    </>
                  )}
                </Button>
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
              </div>
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

        {/* Карточка с готовой иллюстрацией — только для Безопасность всегда */}
        {isBez && !isGenerating && (isGeneratingImage || imageUrl || imageError) && (
          <Card className="border-violet-200/60 dark:border-violet-800/40 shadow-sm">
            <CardHeader className="bg-violet-50/50 dark:bg-violet-950/20 pb-3 border-b border-violet-200/60 dark:border-violet-800/40 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium text-violet-700 dark:text-violet-400 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Иллюстрация
              </CardTitle>
              {imageUrl && (
                <a href={imageUrl} target="_blank" rel="noopener noreferrer" download="illustration.png">
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <Download className="w-3.5 h-3.5" />
                    Открыть / скачать
                  </Button>
                </a>
              )}
            </CardHeader>
            <CardContent className="p-4">
              {isGeneratingImage && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Художник рисует иллюстрацию...
                </div>
              )}
              {imageError && !isGeneratingImage && (
                <p className="text-sm text-destructive text-center py-4">{imageError}</p>
              )}
              {imageUrl && !isGeneratingImage && (
                <img src={imageUrl} alt="Иллюстрация к посту" className="w-full rounded-md" />
              )}
            </CardContent>
          </Card>
        )}

        {/* Карточка промпта для иллюстрации — только для Безопасность всегда */}
        {isBez && imagePrompt && !isGenerating && (
          <Card className="border-amber-200/60 dark:border-amber-800/40 shadow-sm">
            <CardHeader className="bg-amber-50/50 dark:bg-amber-950/20 pb-3 border-b border-amber-200/60 dark:border-amber-800/40 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <Wand2 className="w-4 h-4" />
                Промпт для иллюстрации
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  void navigator.clipboard.writeText(imagePrompt);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? (
                  <><CheckIcon className="w-3.5 h-3.5 text-green-500" />Скопировано</>
                ) : (
                  <><Copy className="w-3.5 h-3.5" />Скопировать</>
                )}
              </Button>
            </CardHeader>
            <CardContent className="p-4">
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground bg-muted/30 rounded-md p-3 select-all">
                {imagePrompt}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
