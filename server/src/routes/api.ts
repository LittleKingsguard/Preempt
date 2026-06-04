import express from "express";
import tagsRouter from "./api/tags.js";
import handlersRouter from "./api/handlers.js";
import contentRouter from "./api/content.js";
import templatesRouter from "./api/templates.js";
import componentsRouter from "./api/components.js";
import settingsRouter from "./api/settings.js";
import adminRouter from "./api/admin.js";

const router = express.Router();

router.use("/tags", tagsRouter);
router.use("/handlers", handlersRouter);
router.use("/content", contentRouter);
router.use("/template", templatesRouter);
router.use("/components", componentsRouter);
router.use("/settings", settingsRouter);
router.use("/admin", adminRouter);

export default router;
