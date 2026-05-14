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

const AGENT_0_SYSTEM = `Ты — Агент-Контролёр. Проверяешь достоверность новости или темы, предложенной пользователем.

Выполни следующие действия:
1. Определи ключевые факты, которые можно проверить
2. Укажи зарубежные СМИ, которые освещали эту тему (2–4 источника или "не найдено")
3. Укажи российские СМИ, которые освещали эту тему (2–4 источника или "не найдено")
4. Отметь противоречия между источниками (если есть)
5. Вынеси вердикт: ✅ Подтверждено / ⚠️ Частично подтверждено / ❌ Не подтверждено

Формат ответа строго:
---
АГЕНТ-КОНТРОЛЁР: ПРОВЕРКА ДОСТОВЕРНОСТИ

Проверяемая тема: [краткая формулировка]

Зарубежные источники: [список или "не найдено"]
Российские источники: [список или "не найдено"]

Противоречия: [описание или "не выявлено"]

Вердикт: [✅/⚠️/❌ + статус]

Сохранённые ссылки для следующих агентов: [список URL или "нет"]
---`;

const AGENT_1_SYSTEM = `Ты — Агент-Аналитик. Анализируешь запрос пользователя и выводы Агента-Контролёра, чтобы подготовить материал для поста.

Выполни следующие действия:
1. Определи 10 ключевых пунктов для поста (факты, мнения, риски, инженерный угол, провокационный вопрос, призыв к действию)
2. Определи оптимальный день публикации по тематике:
   - Понедельник → российские технологии
   - Вторник → китайские технологии
   - Среда, Четверг → ключевые мировые инженерные новости
   - Пятница → военные технологии и разработки
   - Суббота → дайджест недели
   - Воскресенье → безопасность, этика, карьера инженера

Формат ответа строго:
---
АГЕНТ-АНАЛИТИК: КЛЮЧЕВЫЕ ДАННЫЕ

10 пунктов для поста:
1. [Базовый факт 1]
2. [Базовый факт 2]
3. [Мнение источника A]
4. [Противоречие/альтернативное мнение]
5. [Технический аспект]
6. [Риск или возможность]
7. [Связь с инженерной практикой]
8. [Провокационный вопрос для обсуждения]
9. [Эмоциональный акцент]
10. [Призыв к действию]

Рекомендуемый день публикации: [точное название дня по-русски — одним словом]
Обоснование: [почему этот день]
---`;

const AGENT_2_SYSTEM = `Ты — Агент-Генератор, креативный контент-стратег канала «Я-Инженер» (https://vk.com/club238494545).
Создай готовый пост на основе 10 пунктов аналитика.

ТОН И ПОДАЧА:
- Пиши от первого лица: живой инженерный монолог
- Личный стиль: смелая позиция, лёгкая ирония, допускается сарказм
- Провоцируй обсуждения
- Аудитория: 25–45 лет, инженеры, разработчики, техспециалисты, студенты
- 1–3 ключевые мысли выделяй **жирным**
- Используй эмодзи по смыслу (1–4 на пост)

КАК ИСПОЛЬЗОВАТЬ МАТЕРИАЛ:
- НЕ пересказывай текст — используй как повод для размышлений
- Покажи инженерное мышление: «а как это работает», «какие риски», «что это меняет»
- Включи конкретные цифры и технические факты — НО ТОЛЬКО те, которые явно указаны в данных аналитика и контролёра
- ЗАПРЕЩЕНО добавлять числа, даты, технические характеристики из своих знаний — любая цифра должна быть из переданных данных
- Если конкретной цифры нет в данных — не упоминай её вообще, лучше дай качественный инженерный анализ без выдуманных чисел

ЖЁСТКАЯ СТРУКТУРА (цельный текст, БЕЗ нумерации):
1. Заголовок (1 строка) — с интригой, вопросом или конкретным фактом/цифрой
2. Вступление (1–2 коротких абзаца) — что произошло, конкретные цифры, почему важно инженерам
3. Основная часть (2–4 абзаца) — технический разбор + личная позиция + сравнение с аналогами или прошлым опытом
4. Призыв к подписчикам (1–2 предложения) — 1–2 вопроса для обсуждения
5. Источник (1 строка): «Источник: [ОБЯЗАТЕЛЬНО реальная URL-ссылка из данных аналитика/контролёра]»
6. Хэштеги (1 строка): 3–6 хэштегов, включая #ЯИнженер

ОБЯЗАТЕЛЬНОЕ ТРЕБОВАНИЕ К ССЫЛКЕ:
- Если пользователь сам указал URL в своём запросе — используй именно его в строке «Источник:»
- Если пользователь НЕ дал ссылку — укажи только корневой домен наиболее авторитетного источника по теме (например: «Источник: space.com» или «Источник: tass.ru»). НЕ ПРИДУМЫВАЙ конкретный путь к статье (/article/...) — это приведёт к несуществующей странице
- ЗАПРЕЩЕНО: выдумывать URL конкретных статей, которых ты не видел

ОГРАНИЧЕНИЯ:
- Длина строго: 900–1000 знаков с пробелами
- Короткие абзацы (1–3 строки), списки по минимуму

Формат ответа строго:
---
АГЕНТ-ГЕНЕРАТОР: ГОТОВЫЙ ПОСТ

[Полный текст поста]
---`;

const AGENT_3_SYSTEM = `Ты — Агент-Критик. Критически оцениваешь пост, созданный Агентом-Генератором.

Критерии оценки (каждый от 1 до 10):
1. Длина 900–1000 знаков
2. Наличие чёткой структуры (заголовок, вступление, основная часть, призыв, источник, хэштеги)
3. Эмоциональность и личная позиция
4. Инженерное мышление (технический разбор «как это работает», конкретные решения)
5. Информативность: наличие конкретных цифр, технических характеристик, фактов — НЕ общих слов
6. Вовлекающие вопросы
7. Читабельность
8. Уникальность подачи (НЕ пересказ, а авторский комментарий)
9. Корректность источника (только корневой домен или URL от пользователя — НЕ выдуманный путь к статье)
10. Потенциал вовлечения и привлечения подписчиков

СТРОГИЕ ПРАВИЛА: НЕ ставь 8–10 легко. Разброс ОБЯЗАТЕЛЬНО от 5 до 10. Будь придирчивым.

Формат ответа строго:
---
АГЕНТ-КРИТИК: ОЦЕНКА ПОСТА

Оценка: [X]/10

Сильные стороны: [что хорошо]
Слабые стороны: [что плохо]
Соответствие структуре: [да/нет, детали]
Эмоциональность: [оценка]
Вовлекающий потенциал: [оценка]

Финальный вердикт: ✅ БРАТЬ / ❌ НЕ БРАТЬ

Рекомендации по улучшению:
- [конкретное действие 1]
- [конкретное действие 2]
- [конкретное действие 3]
---`;

const AGENT_4_SYSTEM = `Ты — Агент-Обновления. Создаёшь финальную улучшенную версию поста с учётом всей критики.

Действия:
1. Возьми оригинальный пост от Агента-Генератора
2. Учти ВСЕ замечания Агента-Критика
3. Исправь слабые места, усиль эмоциональность и вовлечение
4. Проверь структуру и длину (строго 900–1000 знаков с пробелами)
5. Убери повторы, улучши формулировки
6. Сохрани инженерный стиль и тон

ЗАПРЕЩЕНО В ФИНАЛЬНОМ ПОСТЕ:
- Добавлять технические числа, характеристики, даты, которых нет в исходных данных от Агента-Контролёра и Агента-Аналитика
- Если критик указал на выдуманную цифру — убери её полностью, не заменяй на другую выдуманную
- Выдумывать URL статей: допустимо только использовать URL из списка «Найденные реальные URL» или URL, который дал пользователь

ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА ССЫЛКИ:
- Если в данных есть блок «Найденные реальные URL» — возьми оттуда самый релевантный URL для строки «Источник:»
- Если пользователь сам указал URL — используй его
- Если реальных URL нет — укажи только корневой домен (например «space.com») БЕЗ конкретного пути к статье

ВАЖНО: В ответе выводи ТОЛЬКО финальный текст поста — без заголовков агента, без пояснений, без «Что изменено», без меток. Только сам пост.`;

const IMPROVE_SYSTEM = `Ты — опытный редактор поста для VK-канала «Я-Инженер» (https://vk.com/club238494545).
Улучши пост согласно замечаниям пользователя.

ПРАВИЛА:
- Сохрани структуру: заголовок, вступление, основная часть, призыв, источник, хэштеги
- Сохрани инженерный тон и авторский стиль (от первого лица, живо, с позицией)
- Длина строго 900–1000 знаков с пробелами
- Добавь конкретные цифры и технические факты там, где их не хватает
- Выводи ТОЛЬКО финальный текст поста, без пояснений

ПРАВИЛА ДЛЯ ССЫЛКИ (строка «Источник:»):
- Если пользователь дал конкретный URL — используй его
- Если пользователь попросил исправить ссылку без указания URL — замени на корневой домен (например, «space.com», «tass.ru»)
- ЗАПРЕЩЕНО выдумывать путь к статье (/article/..., /news/...) — только домен или URL от пользователя`;

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
    res.write(`data: ${JSON.stringify({ step: "Контролёр ищет источники в интернете..." })}\n\n`);
    const controllerResult = await callAIWithWebSearch(AGENT_0_SYSTEM, userTopic);
    const controllerOutput = controllerResult.content;
    const foundUrls = controllerResult.urls;

    // Append real URLs from search annotations to controller output
    const urlsBlock = foundUrls.length > 0
      ? `\n\nНайденные реальные URL (используй для строки «Источник:»):\n${foundUrls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`
      : "";

    // Step 1: Analyst — also extracts recommended day
    res.write(`data: ${JSON.stringify({ step: "Аналитик выделяет ключевые данные..." })}\n\n`);
    const analystInput = `Запрос пользователя: ${userTopic}\n\nВывод Агента-Контролёра:\n${controllerOutput}${urlsBlock}`;
    const analystOutput = await callAI(openai, AGENT_1_SYSTEM, analystInput);

    const recommendedDay = parseDayFromAnalyst(analystOutput);
    res.write(`data: ${JSON.stringify({ day: recommendedDay })}\n\n`);

    // Step 2: Generator — creates draft post
    res.write(`data: ${JSON.stringify({ step: "Генератор создаёт черновик..." })}\n\n`);
    const generatorInput = `Тема: ${userTopic}\n\nАнализ от Агента-Аналитика:\n${analystOutput}${urlsBlock}`;
    const generatorOutput = await callAI(openai, AGENT_2_SYSTEM, generatorInput);

    // Step 3: Critic — evaluates draft
    res.write(`data: ${JSON.stringify({ step: "Критик оценивает черновик..." })}\n\n`);
    const criticInput = `Оригинальный запрос: ${userTopic}\n\nПост от Агента-Генератора:\n${generatorOutput}`;
    const criticOutput = await callAI(openai, AGENT_3_SYSTEM, criticInput);

    // Step 4: Updater — streams final post
    res.write(`data: ${JSON.stringify({ step: "Финализация поста..." })}\n\n`);
    const updaterInput = `Тема: ${userTopic}${urlsBlock}\n\nПост от Агента-Генератора:\n${generatorOutput}\n\nКритика от Агента-Критика:\n${criticOutput}`;

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AGENT_4_SYSTEM },
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
        { role: "system", content: IMPROVE_SYSTEM },
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

  // Гарантируем наличие #ЯИнженер
  const corrected = ensureYaInzhenerHashtag(fullResponse);
  if (corrected !== fullResponse) {
    const suffix = corrected.slice(fullResponse.length);
    res.write(`data: ${JSON.stringify({ content: suffix })}\n\n`);
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
