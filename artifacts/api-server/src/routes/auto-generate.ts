import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { GetPostResponse } from "@workspace/api-zod";
import {
  getFreshPosts,
  generatePostFromSources,
  generateBezPost,
  markHashesUsed,
} from "../lib/auto-generator.js";

const router: IRouter = Router();

// ─── Я-Инженер: парсит Telegram-источник и генерирует пост ───────────────────

router.post("/auto-generate", async (req, res): Promise<void> => {
  try {
    const scheduled = await db
      .select({ scheduledAt: postsTable.scheduledAt })
      .from(postsTable)
      .where(eq(postsTable.status, "scheduled"));

    const scheduledDates = scheduled
      .map((r) => r.scheduledAt?.toISOString() ?? "")
      .filter(Boolean);

    const { posts: freshPosts, wasReset } = await getFreshPosts();
    if (wasReset) {
      req.log.info("used_sources history was reset — all posts re-available");
    }

    const generated = await generatePostFromSources(freshPosts, scheduledDates);

    const [post] = await db
      .insert(postsTable)
      .values({
        title: generated.title,
        content: generated.content,
        status: "scheduled",
        recommendedDay: generated.recommendedDay,
        channel: "ya-inzhener",
        scheduledAt: new Date(generated.scheduledAt),
      })
      .returning();

    await markHashesUsed([generated.usedHash]);

    req.log.info(
      { postId: post.id, scheduledAt: generated.scheduledAt, usedHash: generated.usedHash },
      "YI Auto-generated post saved",
    );

    res.status(201).json(GetPostResponse.parse(post));
  } catch (err) {
    req.log.error({ err }, "YI Auto-generate failed");
    res.status(502).json({ error: String(err) });
  }
});

// ─── Безопасность всегда: AI выбирает тему безопасности самостоятельно ────────

router.post("/bez-auto-generate", async (req, res): Promise<void> => {
  try {
    const scheduled = await db
      .select({ scheduledAt: postsTable.scheduledAt })
      .from(postsTable)
      .where(eq(postsTable.status, "scheduled"));

    const scheduledDates = scheduled
      .map((r) => r.scheduledAt?.toISOString() ?? "")
      .filter(Boolean);

    const generated = await generateBezPost(scheduledDates);

    const [post] = await db
      .insert(postsTable)
      .values({
        title: generated.title,
        content: generated.content,
        status: "scheduled",
        recommendedDay: generated.recommendedDay,
        channel: "bezopasnost",
        scheduledAt: new Date(), // немедленная публикация для отладки промптов
      })
      .returning();

    req.log.info(
      { postId: post.id, scheduledAt: generated.scheduledAt },
      "BEZ Auto-generated post saved",
    );

    res.status(201).json(GetPostResponse.parse(post));
  } catch (err) {
    req.log.error({ err }, "BEZ Auto-generate failed");
    res.status(502).json({ error: String(err) });
  }
});

export default router;
