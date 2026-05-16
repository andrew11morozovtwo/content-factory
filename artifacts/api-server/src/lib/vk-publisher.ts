import { lte, eq } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { logger } from "./logger";

const VK_API_VERSION = "5.131";
const VK_API_URL = "https://api.vk.com/method/wall.post";
const POLL_INTERVAL_MS = 60_000;

export async function publishPostToVk(postId: number, content: string): Promise<void> {
  const token = process.env["VK_ACCESS_TOKEN"];
  const groupId = process.env["VK_GROUP_ID"];

  if (!token || !groupId) {
    logger.warn({ postId }, "VK credentials missing, skipping publish");
    return;
  }

  // Strip any non-numeric prefix (e.g. "club238494545" → "238494545")
  const numericGroupId = groupId.replace(/\D/g, "");

  const params = new URLSearchParams({
    owner_id: `-${numericGroupId}`,
    message: content,
    access_token: token,
    v: VK_API_VERSION,
  });

  const response = await fetch(`${VK_API_URL}?${params.toString()}`, {
    method: "POST",
  });

  const data = await response.json() as {
    response?: { post_id: number };
    error?: { error_code: number; error_msg: string };
  };

  if (data.error) {
    throw new Error(`VK API error ${data.error.error_code}: ${data.error.error_msg}`);
  }

  logger.info({ postId, vkPostId: data.response?.post_id }, "Published to VK");
}

async function processDuePosts(): Promise<void> {
  const now = new Date();

  const duePosts = await db
    .select()
    .from(postsTable)
    .where(
      // status = 'scheduled' AND scheduledAt <= now
      lte(postsTable.scheduledAt, now)
    );

  const scheduledDue = duePosts.filter((p) => p.status === "scheduled");

  if (scheduledDue.length === 0) return;

  logger.info({ count: scheduledDue.length }, "Processing due posts for VK");

  for (const post of scheduledDue) {
    try {
      await publishPostToVk(post.id, post.content);

      await db
        .update(postsTable)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(postsTable.id, post.id));

      logger.info({ postId: post.id, title: post.title }, "Post published and marked as published");
    } catch (err) {
      logger.error({ err, postId: post.id }, "Failed to publish post to VK");
    }
  }
}

export function startVkPublisher(): void {
  const token = process.env["VK_ACCESS_TOKEN"];
  const groupId = process.env["VK_GROUP_ID"];

  if (!token || !groupId) {
    logger.warn("VK_ACCESS_TOKEN or VK_GROUP_ID not set — VK auto-publisher disabled");
    return;
  }

  logger.info({ groupId, pollIntervalMs: POLL_INTERVAL_MS }, "VK auto-publisher started");

  // Run immediately on startup to catch any posts that are already due
  processDuePosts().catch((err) => logger.error({ err }, "Initial VK publish check failed"));

  setInterval(() => {
    processDuePosts().catch((err) => logger.error({ err }, "VK publish check failed"));
  }, POLL_INTERVAL_MS);
}
