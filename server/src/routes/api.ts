import express from "express";
import tagsRouter from "./api/tags.js";
import handlersRouter from "./api/handlers.js";
import contentRouter from "./api/content.js";
import templatesRouter from "./api/templates.js";
import componentsRouter from "./api/components.js";
import settingsRouter from "./api/settings.js";
import adminRouter from "./api/admin.js";
import userGroupsRouter from "./api/usergroups.js";
import commentsRouter from "./api/comments.js";
import messagesRouter from "./api/messages.js";
import usersRouter from "./api/users.js";
import setupRouter from "./api/setup.js";
import setupTraefikRouter from "./api/setupTraefik.js";

const router = express.Router();

router.use("/tags", tagsRouter);
router.use("/handlers", handlersRouter);
router.use("/content", contentRouter);
router.use("/template", templatesRouter);
router.use("/components", componentsRouter);
router.use("/settings", settingsRouter);
router.use("/admin", adminRouter);
router.use("/usergroups", userGroupsRouter);
router.use("/comments", commentsRouter);
router.use("/messages", messagesRouter);
router.use("/users", usersRouter);
router.use("/setup", setupRouter);
router.use("/setup/traefik", setupTraefikRouter);

export default router;
