import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { GetPostResponse } from "@workspace/api-zod";
import {
  parseTelegramChannel,
  generatePostFromSources,
} from "../lib/auto-generator.js";

const router: IRouter = Router();

router.post("/auto-generate", async (req, res): Promise<void> => {
  try {
    // Get occupied scheduled dates
    const scheduled = await db
      .select({ scheduledAt: postsTable.scheduledAt })
      .from(postsTable)
      .where(eq(postsTable.status, "scheduled"));

    const scheduledDates = scheduled
      .map((r) => r.scheduledAt?.toISOString() ?? "")
      .filter(Boolean);

    // Parse source channel
    const sourcePosts = await parseTelegramChannel();
    if (sourcePosts.length === 0) {
      res.status(502).json({ error: "No posts found in source channel" });
      return;
    }

    // Generate post via AI
    const generated = await generatePostFromSources(sourcePosts, scheduledDates);

    // Save to DB as scheduled
    const [post] = await db
      .insert(postsTable)
      .values({
        title: generated.title,
        content: generated.content,
        status: "scheduled",
        recommendedDay: generated.recommendedDay,
        scheduledAt: new Date(generated.scheduledAt),
      })
      .returning();

    req.log.info({ postId: post.id, scheduledAt: generated.scheduledAt }, "Auto-generated post saved");
    res.status(201).json(GetPostResponse.parse(post));
  } catch (err) {
    req.log.error({ err }, "Auto-generate failed");
    res.status(502).json({ error: String(err) });
  }
});

export default router;
