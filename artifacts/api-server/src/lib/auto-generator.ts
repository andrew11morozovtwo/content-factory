import { createHash } from "crypto";
import { db, usedSourcesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger.js";

const SOURCE_CHANNEL = "https://t.me/s/ieofficial";

export interface ParsedPost {
  text: string;
  hash: string;
  date: string;
}

export interface AutoGenerateResult {
  title: string;
  content: string;
  recommendedDay: number;
  scheduledAt: string;
  usedHash: string;
}

/** Stable short hash for a post text */
function hashText(text: string): string {
  return createHash("sha1").update(text.slice(0, 200)).digest("hex").slice(0, 16);
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

  const posts: ParsedPost[] = [];
  for (let i = 0; i < Math.min(texts.length, 15); i++) {
    posts.push({ text: texts[i], hash: hashText(texts[i]), date: dates[i] ?? "" });
  }

  logger.info({ count: posts.length }, "Parsed posts from source channel");
  return posts;
}

/**
 * Returns posts from the channel that have NOT been used yet.
 * If all are used, clears the history and returns everything (full reset).
 */
export async function getFreshPosts(): Promise<{ posts: ParsedPost[]; wasReset: boolean }> {
  const allParsed = await parseTelegramChannel();

  // Load already-used hashes from DB
  const usedRows = await db.select({ hash: usedSourcesTable.hash }).from(usedSourcesTable);
  const usedHashes = new Set(usedRows.map((r) => r.hash));

  const fresh = allParsed.filter((p) => !usedHashes.has(p.hash));

  // If all posts have been used before — reset the history and start over
  if (fresh.length === 0) {
    logger.info("All source posts already used — resetting used_sources history");
    await db.delete(usedSourcesTable);
    return { posts: allParsed, wasReset: true };
  }

  logger.info(
    { total: allParsed.length, used: usedHashes.size, fresh: fresh.length },
    "Fresh source posts available",
  );
  return { posts: fresh, wasReset: false };
}

/**
 * Marks a set of post hashes as used in the DB.
 */
export async function markHashesUsed(hashes: string[]): Promise<void> {
  if (hashes.length === 0) return;
  // Upsert — ignore conflicts (hash already exists)
  for (const hash of hashes) {
    try {
      await db.insert(usedSourcesTable).values({ hash });
    } catch {
      // unique constraint — already marked, skip
    }
  }
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
 */
export function findNextFreeDate(dayIndex: number, scheduledDates: string[]): Date {
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
 * Calls OpenAI to pick the best fresh post and generate a new post
 * in the style of «Я-Инженер» channel. Returns which source hash was used.
 */
export async function generatePostFromSources(
  posts: ParsedPost[],
  scheduledDates: string[],
): Promise<AutoGenerateResult> {
  const apiKey = process.env["PROXYAPI_KEY"];
  if (!apiKey) throw new Error("PROXYAPI_KEY not configured");

  const postsText = posts
    .map((p, i) => `[${i + 1}] (ID:${p.hash}) ${p.text.slice(0, 600)}`)
    .join("\n\n---\n\n");

  const systemPrompt = `Ты — автоматический генератор постов для VK-канала «Я-Инженер» (https://vk.com/club238494545).
Аудитория: инженеры, разработчики, техспециалисты 25–45 лет.

Расписание по дням:
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
- Источник: только домен t.me/ieofficial
- Обязателен хэштег #ЯИнженер
- ЗАПРЕЩЕНО добавлять выдуманные цифры

Ответь строго в формате JSON (без markdown-блоков):
{
  "chosenId": "<ID поста-источника, скопируй точно из (ID:...) в начале записи>",
  "recommendedDay": <число 0-6>,
  "title": "<заголовок поста, 1 строка>",
  "content": "<полный текст поста 900-1000 знаков>"
}`;

  const userPrompt = `Вот свежие посты из канала-источника @ieofficial (каждый с уникальным ID). Выбери самую интересную инженерную тему и напиши пост для нашего канала «Я-Инженер». Верни chosenId — ID выбранного поста-источника.\n\n${postsText}`;

  const response = await fetch("https://api.proxyapi.ru/openai/v1/chat/completions", {
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
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as {
    chosenId?: string;
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

  // Use chosenId returned by AI, fallback to first post's hash
  const usedHash = parsed.chosenId ?? posts[0]?.hash ?? "";

  const scheduledAt = findNextFreeDate(dayIndex, scheduledDates);

  logger.info(
    { recommendedDay: dayIndex, theme: DAY_THEMES[dayIndex], scheduledAt, usedHash },
    "Auto-generated post",
  );

  return {
    title: parsed.title ?? "Автопост",
    content: parsed.content ?? "",
    recommendedDay: dayIndex,
    scheduledAt: scheduledAt.toISOString(),
    usedHash,
  };
}
