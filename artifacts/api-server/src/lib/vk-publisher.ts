import { lte, eq } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { logger } from "./logger";
import { publishPostToTelegram } from "./telegram-publisher.js";

const VK_API_VERSION = "5.131";
const VK_API_URL = "https://api.vk.com/method/wall.post";
const POLL_INTERVAL_MS = 60_000;

async function uploadPhotoForWall(
  imageUrl: string,
  token: string,
  numericGroupId: string,
): Promise<string> {
  // Step 1: get upload server URL
  const uploadServerRes = await fetch(
    `https://api.vk.com/method/photos.getWallUploadServer?group_id=${numericGroupId}&access_token=${token}&v=${VK_API_VERSION}`,
    { method: "POST" },
  );
  const uploadServerData = await uploadServerRes.json() as {
    response?: { upload_url: string };
    error?: { error_code: number; error_msg: string };
  };
  if (uploadServerData.error) {
    throw new Error(`VK getWallUploadServer error ${uploadServerData.error.error_code}: ${uploadServerData.error.error_msg}`);
  }
  const uploadUrl = uploadServerData.response!.upload_url;

  // Step 2: download the image bytes
  let imageBuffer: Buffer;
  if (imageUrl.startsWith("data:")) {
    const base64 = imageUrl.split(",")[1] ?? "";
    imageBuffer = Buffer.from(base64, "base64");
  } else {
    const imgRes = await fetch(imageUrl);
    imageBuffer = Buffer.from(await imgRes.arrayBuffer());
  }

  // Step 3: upload image to VK's upload server as multipart (native Node 24 FormData/Blob)
  const form = new FormData();
  form.set("photo", new Blob([new Uint8Array(imageBuffer)], { type: "image/png" }), "illustration.png");
  const uploadRes = await fetch(uploadUrl, { method: "POST", body: form });
  const uploadData = await uploadRes.json() as { server: number; photo: string; hash: string };

  // Step 4: save the photo
  const saveParams = new URLSearchParams({
    group_id: numericGroupId,
    server: String(uploadData.server),
    photo: uploadData.photo,
    hash: uploadData.hash,
    access_token: token,
    v: VK_API_VERSION,
  });
  const saveRes = await fetch(`https://api.vk.com/method/photos.saveWallPhoto?${saveParams.toString()}`, { method: "POST" });
  const saveData = await saveRes.json() as {
    response?: Array<{ id: number; owner_id: number }>;
    error?: { error_code: number; error_msg: string };
  };
  if (saveData.error) {
    throw new Error(`VK saveWallPhoto error ${saveData.error.error_code}: ${saveData.error.error_msg}`);
  }
  const photo = saveData.response![0];
  return `photo${photo.owner_id}_${photo.id}`;
}

function getVkCredentials(channel: string): { token: string; groupId: string } {
  if (channel === "bezopasnost") {
    const token = process.env["VK2_ACCESS_TOKEN"] ?? process.env["VK_ACCESS_TOKEN"];
    const groupId = process.env["VK2_GROUP_ID"];
    if (!token || !groupId) {
      throw new Error("VK2_ACCESS_TOKEN / VK_ACCESS_TOKEN or VK2_GROUP_ID not configured for channel bezopasnost");
    }
    return { token, groupId };
  }

  const token = process.env["VK_ACCESS_TOKEN"];
  const groupId = process.env["VK_GROUP_ID"];
  if (!token || !groupId) {
    throw new Error("VK_ACCESS_TOKEN or VK_GROUP_ID not configured");
  }
  return { token, groupId };
}

export async function publishPostToVk(postId: number, content: string, channel = "ya-inzhener", imageUrl?: string | null): Promise<number> {
  const { token, groupId } = getVkCredentials(channel);

  // Strip any non-numeric prefix (e.g. "club238494545" → "238494545")
  const numericGroupId = groupId.replace(/\D/g, "");

  // Upload photo attachment if provided
  let attachment: string | undefined;
  if (imageUrl) {
    try {
      attachment = await uploadPhotoForWall(imageUrl, token, numericGroupId);
      logger.info({ postId, channel, attachment }, "Photo uploaded to VK for wall post");
    } catch (err) {
      logger.warn({ err, postId, channel }, "Failed to upload photo to VK — publishing text only");
    }
  }

  const params = new URLSearchParams({
    owner_id: `-${numericGroupId}`,
    message: content,
    access_token: token,
    v: VK_API_VERSION,
  });
  if (attachment) params.set("attachments", attachment);

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

  const vkPostId = data.response!.post_id;
  logger.info({ postId, vkPostId, channel }, "Published to VK");
  return vkPostId;
}

async function processDuePosts(): Promise<void> {
  const now = new Date();

  const duePosts = await db
    .select()
    .from(postsTable)
    .where(
      lte(postsTable.scheduledAt, now)
    );

  const scheduledDue = duePosts.filter((p) => p.status === "scheduled");

  if (scheduledDue.length === 0) return;

  logger.info({ count: scheduledDue.length }, "Processing due posts for VK");

  for (const post of scheduledDue) {
    const channel = post.channel ?? "ya-inzhener";
    let vkPostId: number | undefined;
    let telegramMessageId: number | undefined;

    // Publish to VK
    try {
      vkPostId = await publishPostToVk(post.id, post.content, channel);
    } catch (err) {
      logger.error({ err, postId: post.id, channel }, "Failed to publish post to VK");
    }

    // Publish to Telegram (independently — VK failure doesn't block it)
    try {
      const msgId = await publishPostToTelegram(post.id, post.content, channel);
      telegramMessageId = msgId ?? undefined;
    } catch (err) {
      logger.error({ err, postId: post.id, channel }, "Failed to publish post to Telegram");
    }

    // Mark as published regardless of which channels succeeded
    await db
      .update(postsTable)
      .set({ status: "published", publishedAt: new Date(), vkPostId: vkPostId ?? null, telegramMessageId: telegramMessageId ?? null, updatedAt: new Date() })
      .where(eq(postsTable.id, post.id));

    logger.info({ postId: post.id, title: post.title, channel }, "Post processed and marked as published");
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
