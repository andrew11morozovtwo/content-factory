import { Router, type IRouter } from "express";
import {
  getAutopilotInfo,
  setAutopilotEnabled,
} from "../lib/autopilot-scheduler.js";

const router: IRouter = Router();

router.get("/autopilot", async (req, res): Promise<void> => {
  try {
    const info = await getAutopilotInfo();
    res.json(info);
  } catch (err) {
    req.log.error({ err }, "Get autopilot failed");
    res.status(500).json({ error: String(err) });
  }
});

router.post("/autopilot", async (req, res): Promise<void> => {
  try {
    const body = req.body as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    await setAutopilotEnabled(body.enabled);

    const info = await getAutopilotInfo();
    req.log.info({ enabled: body.enabled }, "Autopilot state changed");
    res.json(info);
  } catch (err) {
    req.log.error({ err }, "Set autopilot failed");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
