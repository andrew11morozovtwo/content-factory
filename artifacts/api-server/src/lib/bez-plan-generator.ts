import { eq, and, gte, inArray } from "drizzle-orm";
import { db, postsTable, appSettingsTable } from "@workspace/db";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BezPlanDay {
  date: string;   // YYYY-MM-DD
  topic: string;
}

export interface BezPlanWeek {
  weekStart: string;
  weekEnd: string;
  theme: string;
  days: BezPlanDay[];
}

export interface BezPlan {
  generatedAt: string;
  startDate: string;
  endDate: string;
  weeks: BezPlanWeek[];
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Returns the next Monday (or today if today is Monday) */
function getNextMonday(): Date {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun,1=Mon,...6=Sat
  const daysUntil = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  const monday = addDays(now, daysUntil);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function buildWeekDates(startDate: Date, numWeeks: number): { weekStart: string; weekEnd: string; dates: string[] }[] {
  const weeks = [];
  let current = new Date(startDate);
  for (let i = 0; i < numWeeks; i++) {
    const weekStart = formatDate(current);
    const weekEnd = formatDate(addDays(current, 6));
    const dates: string[] = [];
    for (let j = 0; j < 7; j++) {
      dates.push(formatDate(addDays(current, j)));
    }
    weeks.push({ weekStart, weekEnd, dates });
    current = addDays(current, 7);
  }
  return weeks;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const rows = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key));
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

/** Fetches titles/topics of recent bezopasnost posts to avoid repetition */
async function getRecentBezTopics(): Promise<string[]> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const posts = await db
    .select({ title: postsTable.title })
    .from(postsTable)
    .where(
      and(
        eq(postsTable.channel, "bezopasnost"),
        inArray(postsTable.status, ["published", "scheduled"]),
        gte(postsTable.createdAt, sixMonthsAgo),
      ),
    );

  return posts.map((p) => p.title).filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getBezPlan(): Promise<BezPlan | null> {
  const raw = await getSetting("bez_publication_plan");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BezPlan;
  } catch {
    return null;
  }
}

/** Finds the topic for today from the stored plan. Returns null if not found. */
export async function getTodayBezTopic(): Promise<string | null> {
  const plan = await getBezPlan();
  if (!plan) return null;
  const todayStr = formatDate(new Date());
  for (const week of plan.weeks) {
    const day = week.days.find((d) => d.date === todayStr);
    if (day) return day.topic;
  }
  return null;
}

/** Generates a 3-month publication plan using AI and saves it to the DB. */
export async function generateAndSaveBezPlan(): Promise<BezPlan> {
  const apiKey = process.env["PROXYAPI_KEY"];
  if (!apiKey) throw new Error("PROXYAPI_KEY not configured");

  const NUM_WEEKS = 13; // ~3 months
  const startDate = getNextMonday();
  const weekDates = buildWeekDates(startDate, NUM_WEEKS);
  const endDate = weekDates[weekDates.length - 1]!.weekEnd;

  const recentTopics = await getRecentBezTopics();

  const today = new Date();
  const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const seasonNote = `Текущий период: ${MONTH_NAMES[today.getMonth()]} ${today.getFullYear()}. Россия, умеренный климат.`;

  const recentBlock =
    recentTopics.length > 0
      ? `\nУже опубликованные темы за последние 6 месяцев — НЕ ПОВТОРЯТЬ близкие формулировки:\n${recentTopics.slice(0, 40).map((t) => `- ${t}`).join("\n")}`
      : "";

  const weeksList = weekDates
    .map((w) => `${w.weekStart} — ${w.weekEnd}: дни [${w.dates.join(", ")}]`)
    .join("\n");

  const systemPrompt = `Ты — опытный контент-менеджер VK-канала «Безопасность всегда».
Аудитория: обычные люди в России (домохозяйки, родители, студенты, пожилые люди).
${seasonNote}

Сгенерируй подробный план публикаций на 13 недель (~3 месяца) в формате JSON.

ФОРМАТ ОТВЕТА — строго JSON-объект (без markdown-блоков):
{
  "weeks": [
    {
      "weekStart": "YYYY-MM-DD",
      "weekEnd": "YYYY-MM-DD",
      "theme": "Конкретная тема недели",
      "days": [
        { "date": "YYYY-MM-DD", "topic": "Конкретная тема поста" },
        ... (ровно 7 объектов на неделю)
      ]
    },
    ...
  ]
}

ПРАВИЛА ТЕМАТИКИ:
1. ТЕМА НЕДЕЛИ — конкретная, узкая (НЕ «Безопасность летом», А «Первая помощь при солнечном ударе»)
2. ТЕМА ПОСТА — конкретный совет или ситуация (НЕ «Безопасность детей», А «Ребёнок потерялся в торговом центре: алгоритм действий для родителей»)
3. Сезонность строго по месяцам: июнь = жара/вода/дача, июль = купание/комары/гроза, август = грибы/ягоды/конец лета, сентябрь = школа/осень/погода
4. Суббота каждой недели — ВСЕГДА опрос, тема начинается с «Опрос:»
5. Воскресенье каждой недели — ВСЕГДА пост-приглашение, тема начинается с «Пригласите друзей»
6. Каждая пара соседних недель не должна повторять смежные темы
7. Чередуй типы тем: ПДД / пожар / бытовые травмы / природа / здоровье / дети / пожилые / финансовое мошенничество
${recentBlock}`;

  const userPrompt = `Сгенерируй план для следующих недель (используй точно эти даты в полях date, weekStart, weekEnd):
${weeksList}`;

  logger.info({ numWeeks: NUM_WEEKS, startDate: formatDate(startDate) }, "Generating BEZ publication plan with AI");

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
      temperature: 0.75,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { weeks?: BezPlanWeek[] };

  if (!parsed.weeks || parsed.weeks.length === 0) {
    throw new Error("AI returned an empty plan");
  }

  const plan: BezPlan = {
    generatedAt: new Date().toISOString(),
    startDate: formatDate(startDate),
    endDate,
    weeks: parsed.weeks,
  };

  await setSetting("bez_publication_plan", JSON.stringify(plan));

  logger.info(
    { numWeeks: plan.weeks.length, startDate: plan.startDate, endDate: plan.endDate },
    "BEZ publication plan generated and saved",
  );

  return plan;
}
