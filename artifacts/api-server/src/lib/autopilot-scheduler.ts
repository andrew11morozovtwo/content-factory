import { and, gte, lt, inArray, eq } from "drizzle-orm";
import { db, postsTable, appSettingsTable } from "@workspace/db";
import { logger } from "./logger.js";
import {
  getFreshPosts,
  generatePostFromSources,
  generateBezPost,
  markHashesUsed,
} from "./auto-generator.js";
import { buildIllustrationPrompt, generateIllustration } from "./image-generator.js";

// ─── Time constants ────────────────────────────────────────────────────────────
const MSK_OFFSET_HOURS = 3;

// Я-Инженер: 12:00 MSK = 09:00 UTC
const YI_HOUR_MSK = 12;
const YI_MINUTE_MSK = 0;

// Безопасность всегда: 10:00 MSK = 07:00 UTC
const BEZ_HOUR_MSK = 10;
const BEZ_MINUTE_MSK = 0;

// DEBUG: каждые 15 минут до 12:00 МСК 10 июня 2026. Убрать после теста.
const BEZ_DEBUG_END_UTC = new Date("2026-06-10T09:00:00.000Z"); // 12:00 MSK
const BEZ_DEBUG_INTERVAL_MS = 15 * 60 * 1000; // 15 минут
const BEZ_DEBUG_COOLDOWN_MS = 13 * 60 * 1000; // не чаще раза в 13 минут

// ─── DB helpers ──────────────────────────────────────────────────────────────

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

// ─── Shared: check if a post already exists for today in a specific channel ───

async function hasTodayPostForChannel(channel: string): Promise<boolean> {
  const now = new Date();
  const mskNow = new Date(now.getTime() + MSK_OFFSET_HOURS * 3_600_000);
  const todayMskStart = new Date(
    Date.UTC(
      mskNow.getUTCFullYear(),
      mskNow.getUTCMonth(),
      mskNow.getUTCDate(),
    ) - MSK_OFFSET_HOURS * 3_600_000,
  );
  const tomorrowMskStart = new Date(todayMskStart.getTime() + 86_400_000);

  const posts = await db
    .select({ id: postsTable.id })
    .from(postsTable)
    .where(
      and(
        gte(postsTable.scheduledAt, todayMskStart),
        lt(postsTable.scheduledAt, tomorrowMskStart),
        inArray(postsTable.status, ["scheduled", "published"]),
        eq(postsTable.channel, channel),
      ),
    );

  return posts.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ЯИ-ИНЖЕНЕР AUTOPILOT
// ─────────────────────────────────────────────────────────────────────────────

let yiNextRunTimer: ReturnType<typeof setTimeout> | null = null;
let yiNextRunAt: Date | null = null;

export async function isAutopilotEnabled(): Promise<boolean> {
  return (await getSetting("autopilot_enabled")) === "true";
}

export async function getAutopilotInfo(): Promise<{
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}> {
  const [enabled, lastRunAt] = await Promise.all([
    isAutopilotEnabled(),
    getSetting("autopilot_last_run"),
  ]);
  return {
    enabled,
    lastRunAt: lastRunAt ?? null,
    nextRunAt: yiNextRunAt?.toISOString() ?? null,
  };
}

export async function setAutopilotEnabled(enabled: boolean): Promise<void> {
  await setSetting("autopilot_enabled", enabled ? "true" : "false");
  if (enabled) {
    runAutopilotCheck().catch((err) =>
      logger.error({ err }, "YI Autopilot immediate check failed"),
    );
  }
}

export async function runAutopilotCheck(): Promise<void> {
  const enabled = await isAutopilotEnabled();
  if (!enabled) {
    logger.info("YI Autopilot check skipped — disabled");
    return;
  }

  logger.info("YI Autopilot check started");

  const already = await hasTodayPostForChannel("ya-inzhener");
  if (already) {
    logger.info("YI Autopilot: post for today already exists, skipping");
    await setSetting("autopilot_last_run", new Date().toISOString());
    return;
  }

  logger.info("YI Autopilot: no post for today — generating");

  try {
    const scheduledRows = await db
      .select({ scheduledAt: postsTable.scheduledAt })
      .from(postsTable)
      .where(and(eq(postsTable.status, "scheduled"), eq(postsTable.channel, "ya-inzhener")));

    const scheduledDates = scheduledRows
      .map((r) => r.scheduledAt?.toISOString() ?? "")
      .filter(Boolean);

    const { posts: freshPosts, wasReset } = await getFreshPosts();
    if (wasReset) logger.info("YI Autopilot: used_sources history reset");

    const generated = await generatePostFromSources(freshPosts, scheduledDates);

    const [post] = await db
      .insert(postsTable)
      .values({
        title: generated.title,
        content: generated.content,
        status: "scheduled",
        recommendedDay: generated.recommendedDay,
        channel: "ya-inzhener",
        scheduledAt: new Date(),
      })
      .returning();

    await markHashesUsed([generated.usedHash]);

    logger.info(
      { postId: post.id, usedHash: generated.usedHash },
      "YI Autopilot: post queued for immediate publish",
    );
  } catch (err) {
    logger.error({ err }, "YI Autopilot: generation/publish failed");
  }

  await setSetting("autopilot_last_run", new Date().toISOString());
}

function msUntilYiRun(): number {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(YI_HOUR_MSK - MSK_OFFSET_HOURS, YI_MINUTE_MSK, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleYiNextRun(): void {
  if (yiNextRunTimer) clearTimeout(yiNextRunTimer);

  const ms = msUntilYiRun();
  yiNextRunAt = new Date(Date.now() + ms);

  yiNextRunTimer = setTimeout(async () => {
    await runAutopilotCheck();
    scheduleYiNextRun();
  }, ms);

  logger.info({ nextRunAt: yiNextRunAt.toISOString() }, "YI Autopilot next run scheduled");
}

export function startAutopilotScheduler(): void {
  scheduleYiNextRun();
  logger.info("YI Autopilot scheduler started (12:00 MSK)");
}

// ─────────────────────────────────────────────────────────────────────────────
// БЕЗОПАСНОСТЬ ВСЕГДА AUTOPILOT
// ─────────────────────────────────────────────────────────────────────────────

let bezNextRunTimer: ReturnType<typeof setTimeout> | null = null;
let bezNextRunAt: Date | null = null;

export async function isBezAutopilotEnabled(): Promise<boolean> {
  return (await getSetting("bez_autopilot_enabled")) === "true";
}

export async function getBezAutopilotInfo(): Promise<{
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}> {
  const [enabled, lastRunAt] = await Promise.all([
    isBezAutopilotEnabled(),
    getSetting("bez_autopilot_last_run"),
  ]);
  return {
    enabled,
    lastRunAt: lastRunAt ?? null,
    nextRunAt: bezNextRunAt?.toISOString() ?? null,
  };
}

export async function setBezAutopilotEnabled(enabled: boolean): Promise<void> {
  await setSetting("bez_autopilot_enabled", enabled ? "true" : "false");
  if (enabled) {
    runBezAutopilotCheck().catch((err) =>
      logger.error({ err }, "BEZ Autopilot immediate check failed"),
    );
  }
}

export async function runBezAutopilotCheck(): Promise<void> {
  const enabled = await isBezAutopilotEnabled();
  if (!enabled) {
    logger.info("BEZ Autopilot check skipped — disabled");
    return;
  }

  logger.info("BEZ Autopilot check started");

  const isDebugMode = new Date() < BEZ_DEBUG_END_UTC;

  if (isDebugMode) {
    // DEBUG: вместо "пост сегодня уже есть" — cooldown 13 минут
    const lastRunStr = await getSetting("bez_autopilot_last_run");
    const lastRun = lastRunStr ? new Date(lastRunStr) : null;
    if (lastRun && Date.now() - lastRun.getTime() < BEZ_DEBUG_COOLDOWN_MS) {
      logger.info({ lastRunAt: lastRun.toISOString() }, "BEZ Autopilot (debug): cooldown active, skipping");
      return;
    }
    logger.info("BEZ Autopilot (debug): running in 15-min test mode");
  } else {
    const already = await hasTodayPostForChannel("bezopasnost");
    if (already) {
      logger.info("BEZ Autopilot: post for today already exists, skipping");
      await setSetting("bez_autopilot_last_run", new Date().toISOString());
      return;
    }
  }

  logger.info("BEZ Autopilot: no post for today — generating");

  try {
    const scheduledRows = await db
      .select({ scheduledAt: postsTable.scheduledAt })
      .from(postsTable)
      .where(and(eq(postsTable.status, "scheduled"), eq(postsTable.channel, "bezopasnost")));

    const scheduledDates = scheduledRows
      .map((r) => r.scheduledAt?.toISOString() ?? "")
      .filter(Boolean);

    const generated = await generateBezPost(scheduledDates);

    // Publish after 5 min — gives illustration generation time to finish
    const publishAt = new Date(Date.now() + 5 * 60 * 1000);

    const [post] = await db
      .insert(postsTable)
      .values({
        title: generated.title,
        content: generated.content,
        status: "scheduled",
        recommendedDay: generated.recommendedDay,
        channel: "bezopasnost",
        scheduledAt: publishAt,
      })
      .returning();

    logger.info(
      { postId: post.id, publishAt: publishAt.toISOString() },
      "BEZ Autopilot: post queued, publishing in 5 min",
    );

    // Generate illustration asynchronously — must finish before publishAt
    (async () => {
      try {
        const imgPrompt = await buildIllustrationPrompt(generated.content);
        const illustrationUrl = await generateIllustration(imgPrompt);
        await db
          .update(postsTable)
          .set({ illustrationUrl, updatedAt: new Date() })
          .where(eq(postsTable.id, post.id));
        logger.info({ postId: post.id }, "BEZ Autopilot: illustration saved");
      } catch (imgErr) {
        logger.warn({ imgErr, postId: post.id }, "BEZ Autopilot: illustration failed — post will publish without image");
      }
    })();
  } catch (err) {
    logger.error({ err }, "BEZ Autopilot: generation/publish failed");
  }

  await setSetting("bez_autopilot_last_run", new Date().toISOString());
}

function msUntilBezRun(): number {
  const now = new Date();

  // DEBUG: каждые 15 минут до 12:00 МСК 10 июня 2026
  if (now < BEZ_DEBUG_END_UTC) {
    const nextTick = new Date(
      Math.ceil((now.getTime() + 1000) / BEZ_DEBUG_INTERVAL_MS) * BEZ_DEBUG_INTERVAL_MS,
    );
    if (nextTick < BEZ_DEBUG_END_UTC) {
      return nextTick.getTime() - now.getTime();
    }
  }

  // Штатно: 10:00 МСК ежедневно
  const target = new Date(now);
  target.setUTCHours(BEZ_HOUR_MSK - MSK_OFFSET_HOURS, BEZ_MINUTE_MSK, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleBezNextRun(): void {
  if (bezNextRunTimer) clearTimeout(bezNextRunTimer);

  const ms = msUntilBezRun();
  bezNextRunAt = new Date(Date.now() + ms);

  bezNextRunTimer = setTimeout(async () => {
    await runBezAutopilotCheck();
    scheduleBezNextRun();
  }, ms);

  logger.info({ nextRunAt: bezNextRunAt.toISOString() }, "BEZ Autopilot next run scheduled");
}

export function startBezAutopilotScheduler(): void {
  scheduleBezNextRun();
  logger.info("BEZ Autopilot scheduler started (10:00 MSK)");
}
