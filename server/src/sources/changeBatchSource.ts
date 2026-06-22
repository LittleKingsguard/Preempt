import type { IPreemptEvent } from "../../../src/types/Event.js";
import { pool } from "../db.js";
import { queryFirstRow, fireAndForgetEvent, getLogEventCTE } from "../utils/db.js";
import { dbGetComponentById } from "./componentSource.js";
import { dbGetHandlerById } from "./handlerSource.js";

export async function dbCreateChangeBatch(event: IPreemptEvent, authorId: string, description: string) {
  const cte = getLogEventCTE(event, 3);
  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO ChangeBatches (author_id, description) VALUES ($1, $2) RETURNING id, author_id, description, merged_at, created_at
     ),
     ${cte.sql}
     SELECT * FROM inserted`,
    [authorId, description, ...cte.params]
  );
  return result.rows[0];
}

export async function dbGetChangeBatchById(event: IPreemptEvent, id: number) {
  const res = await queryFirstRow("SELECT * FROM ChangeBatches WHERE id = $1", [id], "Change batch not found");
  fireAndForgetEvent(event);
  return res;
}

export async function dbGetPendingChangeBatches(event: IPreemptEvent) {
  const result = await pool.query("SELECT * FROM ChangeBatches WHERE merged_at IS NULL ORDER BY created_at DESC");
  fireAndForgetEvent(event);
  return result.rows;
}

export async function dbMarkChangeBatchMerged(event: IPreemptEvent, id: number) {
  const cte = getLogEventCTE(event, 2);
  const result = await pool.query(
    `WITH updated AS (
       UPDATE ChangeBatches SET merged_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *
     ),
     ${cte.sql}
     SELECT * FROM updated`,
    [id, ...cte.params]
  );
  if (result.rowCount === 0) {
    return { error: "Change batch not found", status: 404 };
  }
  return result.rows[0];
}

export async function dbDeleteChangeBatch(event: IPreemptEvent, id: number) {
  const cte = getLogEventCTE(event, 2);
  await pool.query(
    `WITH deleted AS (
       DELETE FROM ChangeBatches WHERE id = $1 RETURNING id
     ),
     ${cte.sql}
     SELECT * FROM deleted`,
    [id, ...cte.params]
  );
}

export async function dbApproveChangeBatch(event: IPreemptEvent, batchId: number) {
  const cte = getLogEventCTE(event, 2);
  const result = await pool.query(
    `WITH
      -- Components
      approve_new_components AS (
        UPDATE Components SET is_approved = true WHERE change_batch_id = $1 AND original_id IS NULL
      ),
      archive_old_components AS (
        INSERT INTO Components (name, payload, author_id, original_id, change_batch_id, is_approved)
        SELECT orig.name, orig.payload, orig.author_id, staged.original_id, $1
        FROM Components staged
        JOIN Components orig ON staged.original_id = orig.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
      ),
      update_orig_components AS (
        UPDATE Components orig
        SET payload = staged.payload, is_approved = true
        FROM Components staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = orig.id
      ),
    
      -- Handlers
      approve_new_handlers AS (
        UPDATE Handlers SET is_approved = true WHERE change_batch_id = $1 AND original_id IS NULL
      ),
      archive_old_handlers AS (
        INSERT INTO Handlers (name, body, author_id, original_id, change_batch_id, is_approved)
        SELECT orig.name, orig.body, orig.author_id, staged.original_id, $1
        FROM Handlers staged
        JOIN Handlers orig ON staged.original_id = orig.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
      ),
      update_orig_handlers AS (
        UPDATE Handlers orig
        SET body = staged.body, is_approved = true
        FROM Handlers staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = orig.id
      ),
    
      -- Templates
      approve_new_templates AS (
        UPDATE Templates SET is_approved = true WHERE change_batch_id = $1 AND original_id IS NULL
      ),
      archive_old_templates AS (
        INSERT INTO Templates (author_id, group_id, payload, original_id, change_batch_id, is_approved)
        SELECT orig.author_id, orig.group_id, orig.payload, staged.original_id, $1
        FROM Templates staged
        JOIN Templates orig ON staged.original_id = orig.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
        RETURNING id AS new_archived_id, original_id AS original_id
      ),
      copy_tags_to_archived_templates AS (
        INSERT INTO TemplateTags (template_id, tag_id)
        SELECT aot.new_archived_id, tt.tag_id
        FROM archive_old_templates aot
        JOIN TemplateTags tt ON tt.template_id = aot.original_id
      ),
      copy_components_to_archived_templates AS (
        INSERT INTO TemplateComponents (template_id, component_id)
        SELECT aot.new_archived_id, tc.component_id
        FROM archive_old_templates aot
        JOIN TemplateComponents tc ON tc.template_id = aot.original_id
      ),
      update_orig_templates AS (
        UPDATE Templates orig
        SET payload = staged.payload, is_approved = true
        FROM Templates staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = orig.id
      ),
      clear_orig_template_tags AS (
        DELETE FROM TemplateTags tt
        USING Templates staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = tt.template_id
      ),
      copy_staged_template_tags AS (
        INSERT INTO TemplateTags (template_id, tag_id)
        SELECT staged.original_id, tt.tag_id
        FROM Templates staged
        JOIN TemplateTags tt ON tt.template_id = staged.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
      ),
      clear_orig_template_components AS (
        DELETE FROM TemplateComponents tc
        USING Templates staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = tc.template_id
      ),
      copy_staged_template_components AS (
        INSERT INTO TemplateComponents (template_id, component_id)
        SELECT staged.original_id, tc.component_id
        FROM Templates staged
        JOIN TemplateComponents tc ON tc.template_id = staged.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
      ),
    
      -- Content
      approve_new_content AS (
        UPDATE Content SET is_visible = true WHERE change_batch_id = $1 AND original_id IS NULL
      ),
      archive_old_content AS (
        INSERT INTO Content (author_id, payload, headers, is_visible, original_id, change_batch_id)
        SELECT orig.author_id, orig.payload, orig.headers, false, staged.original_id, $1
        FROM Content staged
        JOIN Content orig ON staged.original_id = orig.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
        RETURNING id AS new_archived_id, original_id AS original_id
      ),
      copy_tags_to_archived_content AS (
        INSERT INTO ContentTags (content_id, tag_id)
        SELECT aoc.new_archived_id, ct.tag_id
        FROM archive_old_content aoc
        JOIN ContentTags ct ON ct.content_id = aoc.original_id
      ),
      copy_groups_to_archived_content AS (
        INSERT INTO ContentTemplateGroups (content_id, group_id)
        SELECT aoc.new_archived_id, ctg.group_id
        FROM archive_old_content aoc
        JOIN ContentTemplateGroups ctg ON ctg.content_id = aoc.original_id
      ),
      copy_components_to_archived_content AS (
        INSERT INTO ContentComponents (content_id, component_id)
        SELECT aoc.new_archived_id, cc.component_id
        FROM archive_old_content aoc
        JOIN ContentComponents cc ON cc.content_id = aoc.original_id
      ),
      update_orig_content AS (
        UPDATE Content orig
        SET payload = staged.payload, headers = staged.headers, is_visible = true
        FROM Content staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = orig.id
      ),
      clear_orig_content_tags AS (
        DELETE FROM ContentTags ct
        USING Content staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = ct.content_id
      ),
      copy_staged_content_tags AS (
        INSERT INTO ContentTags (content_id, tag_id)
        SELECT staged.original_id, ct.tag_id
        FROM Content staged
        JOIN ContentTags ct ON ct.content_id = staged.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
      ),
      clear_orig_content_groups AS (
        DELETE FROM ContentTemplateGroups ctg
        USING Content staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = ctg.content_id
      ),
      copy_staged_content_groups AS (
        INSERT INTO ContentTemplateGroups (content_id, group_id)
        SELECT staged.original_id, ctg.group_id
        FROM Content staged
        JOIN ContentTemplateGroups ctg ON ctg.content_id = staged.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
      ),
      clear_orig_content_components AS (
        DELETE FROM ContentComponents cc
        USING Content staged
        WHERE staged.change_batch_id = $1 AND staged.original_id = cc.content_id
      ),
      copy_staged_content_components AS (
        INSERT INTO ContentComponents (content_id, component_id)
        SELECT staged.original_id, cc.component_id
        FROM Content staged
        JOIN ContentComponents cc ON cc.content_id = staged.id
        WHERE staged.change_batch_id = $1 AND staged.original_id IS NOT NULL
      ),
    
      -- ChangeBatch
      update_change_batch AS (
        UPDATE ChangeBatches SET merged_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *
      ),
      ${cte.sql}
      SELECT * FROM update_change_batch`,
    [batchId, ...cte.params]
  );

  if (result.rowCount === 0) {
    return { error: "Change batch not found", status: 404 };
  }
  return result.rows[0];
}

import type { IChangeBatchSource } from "../models/interfaces.js";
export const pgChangeBatchSource: IChangeBatchSource = {
  create: dbCreateChangeBatch,
  getPending: dbGetPendingChangeBatches,
  getById: dbGetChangeBatchById,
  delete: dbDeleteChangeBatch,
  markMerged: dbMarkChangeBatchMerged,
  approve: dbApproveChangeBatch
};
