import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { GetPostResponse } from "@workspace/api-zod";
import {
  getFreshPosts,
  generatePostFromSources,
  markHashesUsed,
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

    // Get fresh (not yet used) posts from source channel
    const { posts: freshPosts, wasReset } = await getFreshPosts();

    if (wasReset) {
      req.log.info("used_sources history was reset — all posts re-available");
    }

    // Generate post via AI (returns which source hash it used)
    const generated = await generatePostFromSources(freshPosts, scheduledDates);

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

    // Mark the used source post so it won't be picked again
    await markHashesUsed([generated.usedHash]);

    req.log.info(
      { postId: post.id, scheduledAt: generated.scheduledAt, usedHash: generated.usedHash },
      "Auto-generated post saved",
    );

    res.status(201).json(GetPostResponse.parse(post));
  } catch (err) {
    req.log.error({ err }, "Auto-generate failed");
    res.status(502).json({ error: String(err) });
  }
});

export default router;
