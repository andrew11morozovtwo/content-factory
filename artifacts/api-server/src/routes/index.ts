import { Router, type IRouter } from "express";
import healthRouter from "./health";
import postsRouter from "./posts";
import openaiRouter from "./openai";
import autoGenerateRouter from "./auto-generate";

const router: IRouter = Router();

router.use(healthRouter);
router.use(postsRouter);
router.use(openaiRouter);
router.use(autoGenerateRouter);

export default router;
