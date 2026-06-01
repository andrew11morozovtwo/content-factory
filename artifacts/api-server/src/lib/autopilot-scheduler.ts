import { and, gte, lt, inArray, eq } from "drizzle-orm";
import { db, postsTable, appSettingsTable } from "@workspace/db";
import { logger } from "./logger.js";
import {
  getFreshPosts,
  generatePostFromSources,
  markHashesUsed,
} from "./auto-generator.js";

// 13:30 MSK = 10:30 UTC
const MSK_OFFSET_HOURS = 3;
const AUTOPILOT_HOUR_MSK = 13;
const AUTOPILOT_MINUTE_MSK = 30;

let nextRunTimer: ReturnType<typeof setTimeout> | null = null;
let nextRunAt: Date | null = null;

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

// ─── Public state API ─────────────────────────────────────────────────────────

export async function isAutopilotEnabled(): Promise<boolean> {
  const val = await getSetting("autopilot_enabled");
  return val === "true";
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
    nextRunAt: nextRunAt?.toISOString() ?? null,
  };
}

export async function setAutopilotEnabled(enabled: boolean): Promise<void> {
  await setSetting("autopilot_enabled", enabled ? "true" : "false");
  if (enabled) {
    // Immediately check when user turns on autopilot
    runAutopilotCheck().catch((err) =>
      logger.error({ err }, "Autopilot immediate check failed"),
    );
  }
}

// ─── Core check logic ─────────────────────────────────────────────────────────

async function hasTodayPost(): Promise<boolean> {
  const now = new Date();
  // Shift to MSK to get "today" in Moscow time
  const mskNow = new Date(now.getTime() + MSK_OFFSET_HOURS * 3_600_000);
  const todayMskStart = new Date(
    Date.UTC(
      mskNow.getUTCFullYear(),
      mskNow.getUTCMonth(),
      mskNow.getUTCDate(),
    ) -
      MSK_OFFSET_HOURS * 3_600_000,
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
      ),
    );

  return posts.length > 0;
}

export async function runAutopilotCheck(): Promise<void> {
  const enabled = await isAutopilotEnabled();
  if (!enabled) {
    logger.info("Autopilot check skipped — disabled");
    return;
  }

  logger.info("Autopilot check started");

  const already = await hasTodayPost();
  if (already) {
    logger.info("Autopilot: post for today already exists, skipping");
    await setSetting("autopilot_last_run", new Date().toISOString());
    return;
  }

  logger.info("Autopilot: no post for today — generating");

  try {
    const scheduledRows = await db
      .select({ scheduledAt: postsTable.scheduledAt })
      .from(postsTable)
      .where(eq(postsTable.status, "scheduled"));

    const scheduledDates = scheduledRows
      .map((r) => r.scheduledAt?.toISOString() ?? "")
      .filter(Boolean);

    const { posts: freshPosts, wasReset } = await getFreshPosts();
    if (wasReset) logger.info("Autopilot: used_sources history reset");

    const generated = await generatePostFromSources(freshPosts, scheduledDates);

    // scheduledAt = now → VK publisher picks it up within 60s
    const [post] = await db
      .insert(postsTable)
      .values({
        title: generated.title,
        content: generated.content,
        status: "scheduled",
        recommendedDay: generated.recommendedDay,
        scheduledAt: new Date(),
      })
      .returning();

    await markHashesUsed([generated.usedHash]);

    logger.info(
      { postId: post.id, usedHash: generated.usedHash },
      "Autopilot: post queued for immediate publish",
    );
  } catch (err) {
    logger.error({ err }, "Autopilot: generation/publish failed");
  }

  await setSetting("autopilot_last_run", new Date().toISOString());
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

function msUntilNextRun(): number {
  const now = new Date();
  const target = new Date(now);
  // 13:30 MSK = 10:30 UTC
  target.setUTCHours(AUTOPILOT_HOUR_MSK - MSK_OFFSET_HOURS, AUTOPILOT_MINUTE_MSK, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleNextRun(): void {
  if (nextRunTimer) clearTimeout(nextRunTimer);

  const ms = msUntilNextRun();
  nextRunAt = new Date(Date.now() + ms);

  nextRunTimer = setTimeout(async () => {
    await runAutopilotCheck();
    scheduleNextRun(); // arm for the next day
  }, ms);

  logger.info({ nextRunAt: nextRunAt.toISOString() }, "Autopilot next run scheduled");
}

export function startAutopilotScheduler(): void {
  scheduleNextRun();
  logger.info("Autopilot scheduler started");
}
