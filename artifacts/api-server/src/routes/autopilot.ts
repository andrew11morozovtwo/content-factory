import { Router, type IRouter } from "express";
import {
  getAutopilotInfo,
  setAutopilotEnabled,
  getBezAutopilotInfo,
  setBezAutopilotEnabled,
} from "../lib/autopilot-scheduler.js";

const router: IRouter = Router();

// ─── Я-Инженер autopilot ──────────────────────────────────────────────────────

router.get("/autopilot", async (req, res): Promise<void> => {
  try {
    const info = await getAutopilotInfo();
    res.json(info);
  } catch (err) {
    req.log.error({ err }, "Get YI autopilot failed");
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
    req.log.info({ enabled: body.enabled }, "YI Autopilot state changed");
    res.json(info);
  } catch (err) {
    req.log.error({ err }, "Set YI autopilot failed");
    res.status(500).json({ error: String(err) });
  }
});

// ─── Безопасность всегда autopilot ───────────────────────────────────────────

router.get("/bez-autopilot", async (req, res): Promise<void> => {
  try {
    const info = await getBezAutopilotInfo();
    res.json(info);
  } catch (err) {
    req.log.error({ err }, "Get BEZ autopilot failed");
    res.status(500).json({ error: String(err) });
  }
});

router.post("/bez-autopilot", async (req, res): Promise<void> => {
  try {
    const body = req.body as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    await setBezAutopilotEnabled(body.enabled);

    const info = await getBezAutopilotInfo();
    req.log.info({ enabled: body.enabled }, "BEZ Autopilot state changed");
    res.json(info);
  } catch (err) {
    req.log.error({ err }, "Set BEZ autopilot failed");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
