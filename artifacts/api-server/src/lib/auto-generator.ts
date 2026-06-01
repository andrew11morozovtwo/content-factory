import { logger } from "./logger.js";

const SOURCE_CHANNEL = "https://t.me/s/ieofficial";

export interface ParsedPost {
  text: string;
  date: string;
}

export interface AutoGenerateResult {
  title: string;
  content: string;
  recommendedDay: number;
  scheduledAt: string;
}

/**
 * Parses recent posts from a public Telegram channel via t.me/s/<username>
 */
export async function parseTelegramChannel(): Promise<ParsedPost[]> {
  const response = await fetch(SOURCE_CHANNEL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ContentFactory/1.0)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch channel: HTTP ${response.status}`);
  }

  const html = await response.text();

  const posts: ParsedPost[] = [];

  // Extract post text blocks from tgme_widget_message_text
  const textRegex =
    /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const dateRegex = /<time[^>]+datetime="([^"]+)"[^>]*>/gi;

  const texts: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = textRegex.exec(html)) !== null) {
    const raw = m[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#\d+;/g, "")
      .trim();
    if (raw.length > 80) texts.push(raw);
  }

  const dates: string[] = [];
  dateRegex.lastIndex = 0;
  while ((m = dateRegex.exec(html)) !== null) {
    dates.push(m[1]);
  }

  for (let i = 0; i < Math.min(texts.length, 10); i++) {
    posts.push({ text: texts[i], date: dates[i] ?? "" });
  }

  logger.info({ count: posts.length }, "Parsed posts from source channel");
  return posts;
}

const DAY_THEMES: Record<number, string> = {
  1: "российские технологии",
  2: "китайские технологии",
  3: "ключевые мировые инженерные новости",
  4: "ключевые мировые инженерные новости",
  5: "военные технологии и разработки",
  6: "дайджест недели",
  0: "безопасность, этика, карьера инженера",
};

/**
 * Finds the next free date (no scheduled post) for a given weekday (0=Sun..6=Sat).
 * scheduledDates is a list of ISO strings already occupied.
 */
export function findNextFreeDate(
  dayIndex: number,
  scheduledDates: string[],
): Date {
  const occupied = scheduledDates.map((d) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
  });

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayDay = today.getDay();

  let daysUntil = dayIndex - todayDay;
  if (daysUntil < 0) daysUntil += 7;

  const candidate = new Date(today);
  candidate.setDate(today.getDate() + daysUntil);

  for (let week = 0; week < 52; week++) {
    const key = `${candidate.getFullYear()}-${candidate.getMonth()}-${candidate.getDate()}`;
    if (!occupied.includes(key)) return new Date(candidate);
    candidate.setDate(candidate.getDate() + 7);
  }

  return candidate;
}

/**
 * Calls OpenAI to select the best post from parsed ones and generate a new post
 * in the style of «Я-Инженер» channel.
 */
export async function generatePostFromSources(
  posts: ParsedPost[],
  scheduledDates: string[],
): Promise<AutoGenerateResult> {
  const apiKey = process.env["PROXYAPI_KEY"];
  if (!apiKey) throw new Error("PROXYAPI_KEY not configured");

  const postsText = posts
    .map((p, i) => `[${i + 1}] ${p.text.slice(0, 600)}`)
    .join("\n\n---\n\n");

  const systemPrompt = `Ты — автоматический генератор постов для VK-канала «Я-Инженер» (https://vk.com/club238494545).
Аудитория: инженеры, разработчики, техспециалисты 25–45 лет.

Расписание по дням (выбери подходящий):
- Понедельник (1) → российские технологии
- Вторник (2) → китайские технологии
- Среда (3) / Четверг (4) → мировые инженерные новости
- Пятница (5) → военные технологии
- Суббота (6) → дайджест
- Воскресенье (0) → безопасность / этика

Правила написания поста:
- Живой инженерный монолог от первого лица, смелая позиция, лёгкая ирония
- ЗАПРЕЩЕНО использовать Markdown: никаких **, *, _, # — VK не поддерживает
- Эмодзи по смыслу (1–4 на пост)
- Структура: заголовок → вступление → технический разбор → вопрос подписчикам → источник → хэштеги
- Длина строго 900–1000 знаков с пробелами
- Источник: только домен канала t.me/ieofficial
- Обязателен хэштег #ЯИнженер
- ЗАПРЕЩЕНО добавлять выдуманные цифры — только то, что есть в материале

Ответь строго в формате JSON (без markdown-блоков):
{
  "recommendedDay": <число 0-6>,
  "title": "<заголовок поста, 1 строка>",
  "content": "<полный текст поста 900-1000 знаков>"
}`;

  const userPrompt = `Вот последние посты из канала-источника @ieofficial. Выбери самую интересную инженерную тему и напиши пост для нашего канала «Я-Инженер»:\n\n${postsText}`;

  const response = await fetch(
    "https://api.proxyapi.ru/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as {
    recommendedDay: number;
    title: string;
    content: string;
  };

  const dayIndex =
    typeof parsed.recommendedDay === "number" &&
    parsed.recommendedDay >= 0 &&
    parsed.recommendedDay <= 6
      ? parsed.recommendedDay
      : 3;

  const scheduledAt = findNextFreeDate(dayIndex, scheduledDates);

  logger.info(
    { recommendedDay: dayIndex, theme: DAY_THEMES[dayIndex], scheduledAt },
    "Auto-generated post",
  );

  return {
    title: parsed.title ?? "Автопост",
    content: parsed.content ?? "",
    recommendedDay: dayIndex,
    scheduledAt: scheduledAt.toISOString(),
  };
}
