import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import chatRouter from "./chat.js";
import calendarRouter from "./calendar.js";
import voiceRouter from "./voice.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(calendarRouter);
router.use(voiceRouter);

export default router;
