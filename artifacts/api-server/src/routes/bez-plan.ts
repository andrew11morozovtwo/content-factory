import { Router, type IRouter } from "express";
import { getBezPlan, generateAndSaveBezPlan, saveBezPlan } from "../lib/bez-plan-generator.js";

const router: IRouter = Router();

router.get("/bez-plan", async (req, res): Promise<void> => {
  try {
    const plan = await getBezPlan();
    res.json(
      plan ?? {
        generatedAt: null,
        startDate: null,
        endDate: null,
        weeks: [],
      },
    );
  } catch (err) {
    req.log.error({ err }, "Get BEZ plan failed");
    res.status(500).json({ error: String(err) });
  }
});

router.post("/bez-plan", async (req, res): Promise<void> => {
  try {
    req.log.info("BEZ plan generation requested");
    const plan = await generateAndSaveBezPlan();
    req.log.info({ numWeeks: plan.weeks.length }, "BEZ plan generated successfully");
    res.status(201).json(plan);
  } catch (err) {
    req.log.error({ err }, "Generate BEZ plan failed");
    res.status(502).json({ error: String(err) });
  }
});

router.patch("/bez-plan", async (req, res): Promise<void> => {
  try {
    const body = req.body as { date?: unknown; topic?: unknown };
    const date = body.date;
    const topic = body.topic;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    if (typeof topic !== "string" || topic.trim().length === 0 || topic.length > 500) {
      res.status(400).json({ error: "topic must be a non-empty string ≤500 chars" });
      return;
    }
    const plan = await getBezPlan();
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    let found = false;
    for (const week of plan.weeks) {
      const day = week.days.find((d) => d.date === date);
      if (day) {
        day.topic = topic;
        found = true;
        break;
      }
    }
    if (!found) {
      res.status(404).json({ error: `Day ${date} not found in plan` });
      return;
    }
    await saveBezPlan(plan);
    req.log.info({ date, topic }, "BEZ plan day updated");
    res.json(plan);
  } catch (err) {
    req.log.error({ err }, "Update BEZ plan day failed");
    res.status(400).json({ error: String(err) });
  }
});

export default router;
