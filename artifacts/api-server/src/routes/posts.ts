import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import {
  ListPostsResponse,
  CreatePostBody,
  GetPostParams,
  GetPostResponse,
  UpdatePostParams,
  UpdatePostBody,
  UpdatePostResponse,
  DeletePostParams,
  GetPostStatsResponse,
} from "@workspace/api-zod";
import { publishPostToVk } from "../lib/vk-publisher.js";
import { publishPostToTelegram } from "../lib/telegram-publisher.js";

const router: IRouter = Router();

router.get("/posts", async (_req, res): Promise<void> => {
  const posts = await db.select().from(postsTable).orderBy(postsTable.createdAt);
  res.json(ListPostsResponse.parse(posts));
});

router.post("/posts", async (req, res): Promise<void> => {
  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { illustrationUrl } = req.body as { illustrationUrl?: string | null };

  const data = {
    ...parsed.data,
    scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    illustrationUrl: illustrationUrl ?? null,
  };

  const [post] = await db.insert(postsTable).values(data).returning();
  res.status(201).json(GetPostResponse.parse(post));
});

router.get("/posts/stats", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      status: postsTable.status,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(postsTable)
    .groupBy(postsTable.status);

  const stats = { total: 0, draft: 0, scheduled: 0, published: 0, rejected: 0 };
  for (const row of rows) {
    const key = row.status as keyof typeof stats;
    if (key in stats) {
      stats[key] = row.count;
      stats.total += row.count;
    }
  }

  res.json(GetPostStatsResponse.parse(stats));
});

router.get("/posts/:id", async (req, res): Promise<void> => {
  const params = GetPostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, params.data.id));
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.json(GetPostResponse.parse(post));
});

router.patch("/posts/:id", async (req, res): Promise<void> => {
  const params = UpdatePostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.scheduledAt !== undefined) {
    data.scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
  }

  const [post] = await db
    .update(postsTable)
    .set(data)
    .where(eq(postsTable.id, params.data.id))
    .returning();

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.json(UpdatePostResponse.parse(post));
});

router.post("/posts/:id/publish", async (req, res): Promise<void> => {
  const params = GetPostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, params.data.id));
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const channel = post.channel ?? "ya-inzhener";

  let vkPostId: number;
  try {
    vkPostId = await publishPostToVk(post.id, post.content, channel, post.illustrationUrl);
  } catch (err) {
    req.log.error({ err, postId: post.id, channel }, "Immediate VK publish failed");
    res.status(502).json({ error: "VK publish failed" });
    return;
  }

  // Publish to Telegram independently — don't abort if it fails
  let telegramMessageId: number | undefined;
  try {
    const msgId = await publishPostToTelegram(post.id, post.content, channel);
    telegramMessageId = msgId ?? undefined;
  } catch (err) {
    req.log.error({ err, postId: post.id, channel }, "Immediate Telegram publish failed");
  }

  const [updated] = await db
    .update(postsTable)
    .set({ status: "published", scheduledAt: null, publishedAt: new Date(), vkPostId, telegramMessageId: telegramMessageId ?? null, updatedAt: new Date() })
    .where(eq(postsTable.id, params.data.id))
    .returning();

  res.json(GetPostResponse.parse(updated));
});

router.delete("/posts/:id", async (req, res): Promise<void> => {
  const params = DeletePostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [post] = await db.delete(postsTable).where(eq(postsTable.id, params.data.id)).returning();
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
