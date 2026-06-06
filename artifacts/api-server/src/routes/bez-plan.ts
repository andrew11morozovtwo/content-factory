import { Router, type IRouter } from "express";
import { getBezPlan, generateAndSaveBezPlan } from "../lib/bez-plan-generator.js";

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

export default router;
