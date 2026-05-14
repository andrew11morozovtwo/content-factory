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

function buildSystemPrompt(topic: string): string {
  const dayName = DAYS_RU[new Date().getDay()];
  return `Ты — креативный контент-стратег Telegram-канала «Я Инженер».
Твоя задача — СРАЗУ выдать один готовый пост для публикации в Telegram, без пояснений и комментариев.
Создай авторский пост длиной 900–1000 знаков (с пробелами) на тему: ${topic}, ориентируясь на ${dayName} и опираясь на ключевую мысль автора: ${topic}.
Тон и подача
• Пиши от первого лица: живой инженерный монолог, как будто опытный инженер рассуждает вслух для коллег.
• Личный стиль: смелая позиция, лёгкая ирония, допускается сарказм и здоровые сомнения, чтобы провоцировать обсуждения.
• Аудитория: 25–45 лет, инженеры, разработчики, техспециалисты, студенты. Пиши просто и понятно, без перегруза терминами.
• Обязательно: 1–3 ключевые мысли выделяй жирным, используй эмодзи по смыслу, но без перегруза (1–4 на пост).
Как использовать статью или новость
• Не пересказывай текст.
• Используй новость/статью как повод для размышлений: критикуй, дополняй, сопоставляй с реальностью и инженерной практикой.
• Обязательно покажи инженерное мышление: «а как это работает», «какие риски», «что это меняет для инженеров».
• Учитывай день недели:
1. Понедельник — новости российских технологий.
2. Вторник — новости китайских технологий.
3. Среда, четверг, пятница — ключевые новости технологий и инженерных разработок.
4. Пятница — ключевые новости военных технологий и инженерных разработок.
5. Суббота — дайджест главных событий недели в инженерии, науке и технологиях.
6. Воскресенье — безопасность, этика, карьера и профессиональное развитие инженера.
Жёсткая структура поста
Строго следуй этой структуре в одном цельном тексте (без нумерации в самом посте):
1. Заголовок (1 строка) — креативный, с интригой, вопросом или фактом/цифрой. Сразу даёт понять тему и позицию автора.
2. Вступление (1–2 коротких абзаца) — быстро актуализируй тему: что произошло / о какой технологии речь. Объясни, почему это важно именно инженерам.
3. Основная часть (2–4 абзаца) — дай чёткий, эмоционально окрашенный анализ. Приведи 1–3 конкретных факта. Обязательно вырази личную позицию.
4. Призыв к подписчикам (1–2 предложения) — задай 1–2 вопроса, приглашающих к обсуждению.
5. Источник (1 строка) — «Источник: [ссылка или тема]».
6. Хэштеги (1 строка) — 3–6 хэштегов, включая #ЯИнженер.
Ограничения (обязательные)
• Пост — это не реферат, а короткий, эмоциональный, умный инженерный комментарий с характером.
• Короткие абзацы (1–3 строки), списки по минимуму.
• Всегда укладывайся в 900–1000 знаков с пробелами.
• В ответе выводи ТОЛЬКО готовый пост, без пояснений, меток, комментариев и описания промпта.`;
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

  const firstUserMessage = history.find((m) => m.role === "user")?.content ?? body.data.content;

  const chatMessages = [
    { role: "system" as const, content: buildSystemPrompt(firstUserMessage) },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  const openai = getProxyClient();

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: chatMessages,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  await db.insert(messages).values({
    conversationId: convId,
    role: "assistant",
    content: fullResponse,
  });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
