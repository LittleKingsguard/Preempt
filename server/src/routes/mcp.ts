import { Router } from "express";
import { mcpAuth, authenticateToken, requireAdmin } from "../middleware/auth.js";
import { Supervisor } from "../../../src/core/Supervisor.js";
import type { PipelineConfig } from "../../../src/types/Pipeline.js";
import { createChangeBatch, getPendingChangeBatches, markChangeBatchMerged, deleteChangeBatch, approveChangeBatch } from "../models/changeBatches.js";
import { stageComponent, updateComponent, getComponentById } from "../models/component.js";
import { stageHandler, updateHandler, getHandlerById } from "../models/handler.js";
import { stageTemplate, updateTemplate, getTemplateById } from "../models/template.js";
import { stageContent, getContentWithTemplate } from "../models/content.js";
import { pool } from "../db.js";

const router = Router();

router.post("/validate-and-save", mcpAuth, async (req, res) => {
  const { templateData, contentData, targets, description } = req.body;
  if (!templateData || !contentData || !targets || !Array.isArray(targets) || !description) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // 1. Run Validation
  Supervisor.resetInstantiation();
  const config: PipelineConfig = {
    runInstantiation: true,
    runAssembly: true,
    runPreprocessing: true,
    runValidation: true,
    runRendering: false,
    runPostprocessing: false,
    runMonitoring: false,
    isValidationRun: true
  };

  try {
    // This will throw if validation fails
    await Supervisor.process(templateData, contentData, config);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Schema validation failed" });
  }

  // 2. Extract targets and save staged rows
  const user = (req as any).user;
  let batch;
  try {
    batch = await createChangeBatch(user.username, description);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create change batch: " + err.message });
  }

  try {
    const savedTargets = [];
    // Ensure the payload exactly matches the validated data by extracting it from the assembled tree
    for (const target of targets) {
      let validatedPayload = target.payload;
      let validatedBody = target.body;

      const rootNode = Supervisor.getRootNode();

      // If a query is provided, use findNode to retrieve the exact NodeData or Handler body from the validated stack
      if (target.query) {
        let matchedNode = rootNode?.findNode(target.query) || null;
        if (!matchedNode) {
          for (const cNode of Supervisor.getContentNodes()) {
            matchedNode = cNode.findNode(target.query) || null;
            if (matchedNode) break;
          }
        }

        if (!matchedNode) {
          throw new Error(`Target extraction failed: Could not find node matching query ${JSON.stringify(target.query)}`);
        }

        if (target.type === 'handler') {
          if (!target.handlerName || !matchedNode.data.handlers || !matchedNode.data.handlers[target.handlerName]) {
            throw new Error(`Target extraction failed: Could not find handler '${target.handlerName}' on matched node`);
          }
          validatedBody = matchedNode.data.handlers[target.handlerName];
        } else if (target.type === 'component') {
          if (!target.name || !matchedNode.data.component) {
            throw new Error(`Target extraction failed: Could not find component array on matched node`);
          }
          const comp = matchedNode.data.component.find((c: any) => c.reference === target.name);
          if (!comp || !comp.value) {
            throw new Error(`Target extraction failed: Could not find component '${target.name}' with a value on matched node`);
          }
          validatedPayload = comp.value;
        } else {
          validatedPayload = matchedNode.exportToJson();
        }
      } else if (target.type === 'template') {
        // Fallback for full template: extract the entire root node
        const exported = Supervisor.exportRootNode();
        if (exported) validatedPayload = exported;
      } else if (target.type === 'content') {
        // Fallback for full content array
        const exportedContentNodes = Supervisor.getContentNodes().map(n => n.exportToJson());
        validatedPayload = { ...target.payload, content: exportedContentNodes };
      }

      let savedData;
      if (target.type === 'component') {
        savedData = await stageComponent(user, target.name, validatedPayload, target.id || null, batch.id);
      } else if (target.type === 'handler') {
        savedData = await stageHandler(user, target.name, validatedBody, target.id || null, batch.id);
      } else if (target.type === 'template') {
        savedData = await stageTemplate(user, validatedPayload, target.id || null, batch.id, target.tags, target.groupId || null);
      } else if (target.type === 'content') {
        savedData = await stageContent(user, validatedPayload, target.headers, target.id || null, batch.id, target.tags, target.groupIds);
      }

      savedTargets.push({
        type: target.type,
        name: target.name,
        id: target.id,
        savedData: savedData
      });
    }
    return res.json({ success: true, batchId: batch.id, savedTargets });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Failed to stage one or more targets: " + err.message });
  }
});

// Admin Routes (Hooked here for convenience, but gated by authenticateToken & requireAdmin)

router.get("/admin/change-batches", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const batches = await getPendingChangeBatches();
    res.json({ batches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch batches" });
  }
});

router.post("/admin/change-batches/:id/reject", authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Cascading delete handles removing staged rows
    await deleteChangeBatch(parseInt(req.params.id as string));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject batch" });
  }
});

router.post("/admin/change-batches/:id/approve", authenticateToken, requireAdmin, async (req, res) => {
  const batchId = parseInt(req.params.id as string);
  try {
    await approveChangeBatch(batchId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve batch" });
  }
});


export default router;
