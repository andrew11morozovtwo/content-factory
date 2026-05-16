import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import OpenAI from "openai";
import {
  CreateOpenaiConversationBody,
  GetOpenaiConversationParams,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  SendOpenaiMessageParams,
  SendOpenaiMessageBody,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";
import {
  AGENT_CONTROLLER,
  AGENT_ANALYST,
  AGENT_GENERATOR,
  AGENT_CRITIC,
  AGENT_UPDATER,
  IMPROVE_EDITOR,
} from "./prompts.js";

const router: IRouter = Router();

function getProxyClient(): OpenAI {
  const apiKey = process.env.PROXYAPI_KEY;
  if (!apiKey) {
    logger.warn("PROXYAPI_KEY is not set — AI requests will fail");
  }
  return new OpenAI({
    apiKey: apiKey ?? "missing",
    baseURL: "https://api.proxyapi.ru/openai/v1",
  });
}

const DAYS_RU = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

function parseDayFromAnalyst(text: string): number {
  for (let i = 0; i < DAYS_RU.length; i++) {
    const pattern = new RegExp(`Рекомендуемый день публикации[^:]*:\\s*${DAYS_RU[i]}`, "i");
    if (pattern.test(text)) return i;
  }
  return new Date().getDay();
}

async function callAI(openai: OpenAI, systemPrompt: string, userMessage: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    stream: false,
  });
  return completion.choices[0]?.message?.content ?? "";
}

interface ControllerResult {
  content: string;
  urls: string[];
}

async function callAIWithWebSearch(systemPrompt: string, userMessage: string): Promise<ControllerResult> {
  const apiKey = process.env.PROXYAPI_KEY ?? "missing";
  const response = await fetch("https://api.proxyapi.ru/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-search-preview",
      web_search_options: {
        search_context_size: "medium",
        user_location: {
          type: "approximate",
          approximate: { country: "RU" },
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const data = await response.json() as {
    choices: Array<{
      message: {
        content: string;
        annotations?: Array<{
          type: string;
          url_citation?: { url: string; title: string };
        }>;
      };
    }>;
    error?: { message: string };
  };

  if (data.error) {
    logger.warn({ error: data.error }, "gpt-4o-search-preview error, falling back to gpt-4o");
    return { content: `Поиск недоступен: ${data.error.message}`, urls: [] };
  }

  const message = data.choices[0]?.message;
  const content = message?.content ?? "";
  const urls = (message?.annotations ?? [])
    .filter((a) => a.type === "url_citation" && a.url_citation)
    .map((a) => a.url_citation!.url)
    .filter((url, i, arr) => arr.indexOf(url) === i); // deduplicate

  logger.info({ foundUrls: urls, annotationsCount: message?.annotations?.length ?? 0 }, "web search controller result");

  return { content, urls };
}

/** Извлекает первый URL из текста запроса пользователя (если есть). */
function extractUserUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s，,\)]+/);
  return match ? match[0] : null;
}

/** Убирает Markdown-разметку (**bold**, *italic*), которую VK не поддерживает. */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, "").replace(/(?<!\*)\*(?!\*)/g, "");
}

/** Гарантирует наличие #ЯИнженер в финальном посте. */
function ensureYaInzhenerHashtag(text: string): string {
  if (text.includes("#ЯИнженер")) return text;
  // Найти строку с хэштегами (начинается с #) и добавить туда
  const hashtagLineRegex = /^(#\S+(?:\s+#\S+)*)$/m;
  if (hashtagLineRegex.test(text)) {
    return text.replace(hashtagLineRegex, "$1 #ЯИнженер");
  }
  // Если строки с хэштегами нет — добавить в конец
  return text.trimEnd() + "\n#ЯИнженер";
}


router.get("/openai/conversations", async (_req, res): Promise<void> => {
  const all = await db.select().from(conversations).orderBy(conversations.createdAt);
  res.json(all);
});

router.post("/openai/conversations", async (req, res): Promise<void> => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [conv] = await db.insert(conversations).values({ title: parsed.data.title }).returning();
  res.status(201).json(conv);
});

router.get("/openai/conversations/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetOpenaiConversationParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, params.data.id));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json({ ...conv, messages: msgs });
});

router.delete("/openai/conversations/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteOpenaiConversationParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(messages).where(eq(messages.conversationId, params.data.id));
  const [conv] = await db.delete(conversations).where(eq(conversations.id, params.data.id)).returning();
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ListOpenaiMessagesParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json(msgs);
});

router.post("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SendOpenaiMessageParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendOpenaiMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const convId = params.data.id;

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await db.insert(messages).values({
    conversationId: convId,
    role: "user",
    content: body.data.content,
  });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(messages.createdAt);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const openai = getProxyClient();
  const userTopic = body.data.content;
  const isFirstMessage = history.filter((m) => m.role === "user").length === 1;
  let fullResponse = "";

  const sendError = (message: string) => {
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  };

  try {
  if (isFirstMessage) {
    // ── 5-agent pipeline ─────────────────────────────────────────────────────

    // Step 0: Controller — uses gpt-4o-search-preview for real web search
    // ── WEB SEARCH DISABLED (for testing) — раскомментировать для продакшена ──
    // res.write(`data: ${JSON.stringify({ step: "Контролёр ищет источники в интернете..." })}\n\n`);
    // const controllerResult = await callAIWithWebSearch(AGENT_CONTROLLER, userTopic);
    // const controllerOutput = controllerResult.content;
    // const foundUrls = controllerResult.urls;
    // ── STUB: веб-поиск отключён ──────────────────────────────────────────────
    const controllerOutput = "";
    const foundUrls: string[] = [];

    // Extract URL provided by the user in their request (highest priority)
    const userProvidedUrl = extractUserUrl(userTopic);

    // Build urlsBlock: user-provided URL goes first and is marked as mandatory
    let urlsBlock = "";
    if (userProvidedUrl) {
      urlsBlock = `\n\nВАЖНО — URL ОТ ПОЛЬЗОВАТЕЛЯ (ОБЯЗАТЕЛЬНО использовать в строке «Источник:», не заменять другим): ${userProvidedUrl}`;
      if (foundUrls.length > 0) {
        urlsBlock += `\n\nДополнительные найденные URL (только для справки, НЕ использовать в «Источник:»):\n${foundUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
      }
    } else if (foundUrls.length > 0) {
      urlsBlock = `\n\nНайденные реальные URL (используй для строки «Источник:»):\n${foundUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
    }

    logger.info({ userProvidedUrl, foundUrls }, "URL resolution");

    // Step 1: Analyst — also extracts recommended day
    res.write(`data: ${JSON.stringify({ step: "Аналитик выделяет ключевые данные..." })}\n\n`);
    const analystInput = `Запрос пользователя: ${userTopic}\n\nВывод Агента-Контролёра:\n${controllerOutput}${urlsBlock}`;
    const analystOutput = await callAI(openai, AGENT_ANALYST, analystInput);

    const recommendedDay = parseDayFromAnalyst(analystOutput);
    res.write(`data: ${JSON.stringify({ day: recommendedDay })}\n\n`);

    // Step 2: Generator — creates draft post
    res.write(`data: ${JSON.stringify({ step: "Генератор создаёт черновик..." })}\n\n`);
    const generatorInput = `Тема: ${userTopic}\n\nАнализ от Агента-Аналитика:\n${analystOutput}${urlsBlock}`;
    const generatorOutput = await callAI(openai, AGENT_GENERATOR, generatorInput);

    // Step 3: Critic — evaluates draft
    res.write(`data: ${JSON.stringify({ step: "Критик оценивает черновик..." })}\n\n`);
    const criticInput = `Оригинальный запрос: ${userTopic}\n\nПост от Агента-Генератора:\n${generatorOutput}`;
    const criticOutput = await callAI(openai, AGENT_CRITIC, criticInput);

    // Step 4: Updater — streams final post
    res.write(`data: ${JSON.stringify({ step: "Финализация поста..." })}\n\n`);
    const updaterInput = `Тема: ${userTopic}${urlsBlock}\n\nПост от Агента-Генератора:\n${generatorOutput}\n\nКритика от Агента-Критика:\n${criticOutput}`;

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AGENT_UPDATER },
        { role: "user", content: updaterInput },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
  } else {
    // Subsequent messages: improvement/correction mode
    const previousMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    res.write(`data: ${JSON.stringify({ step: "Улучшаю пост..." })}\n\n`);

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: IMPROVE_EDITOR },
        ...previousMessages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
  }

  // Убираем Markdown-разметку (VK не поддерживает **bold** и т.п.)
  const stripped = stripMarkdown(fullResponse);
  // Гарантируем наличие #ЯИнженер
  const corrected = ensureYaInzhenerHashtag(stripped);
  // Если текст изменился — отправляем финальную исправленную версию целиком
  if (corrected !== fullResponse) {
    res.write(`data: ${JSON.stringify({ corrected })}\n\n`);
  }

  await db.insert(messages).values({
    conversationId: convId,
    role: "assistant",
    content: corrected,
  });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
  } catch (err: unknown) {
    req.log.error({ err }, "pipeline error");
    const status = (err as { status?: number })?.status;
    const msg = status === 402
      ? "Недостаточно баланса на ProxyAPI. Пополните счёт на proxyapi.ru и попробуйте снова."
      : "Ошибка при генерации. Попробуйте ещё раз.";
    sendError(msg);
  }
});

export default router;
