import { pool } from "../db.js";
import { queryFirstRow } from "../utils/db.js";
import { getComponentById } from "./component.js";
import { getHandlerById } from "./handler.js";

export async function createChangeBatch(authorId: string, description: string) {
  return await queryFirstRow(
    "INSERT INTO ChangeBatches (author_id, description) VALUES ($1, $2) RETURNING id, author_id, description, merged_at, created_at",
    [authorId, description]
  );
}

export async function getChangeBatchById(id: number) {
  return await queryFirstRow("SELECT * FROM ChangeBatches WHERE id = $1", [id]);
}

export async function getPendingChangeBatches() {
  const result = await pool.query("SELECT * FROM ChangeBatches WHERE merged_at IS NULL ORDER BY created_at DESC");
  return result.rows;
}

export async function markChangeBatchMerged(id: number) {
  return await queryFirstRow(
    "UPDATE ChangeBatches SET merged_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
    [id]
  );
}

export async function deleteChangeBatch(id: number) {
  await pool.query("DELETE FROM ChangeBatches WHERE id = $1", [id]);
}

export async function approveChangeBatch(batchId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Process Components
    const components = await client.query("SELECT * FROM Components WHERE change_batch_id = $1", [batchId]);
    for (const comp of components.rows) {
      if (!comp.original_id) {
        await client.query("UPDATE Components SET is_approved = true WHERE id = $1", [comp.id]);
      } else {
        const orig = await getComponentById(comp.original_id);
        if (orig) {
          await client.query(
            "INSERT INTO Components (name, payload, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false)",
            [orig.name, orig.payload, orig.author_id, comp.original_id, batchId]
          );
          await client.query("UPDATE Components SET payload = $1, is_approved = true WHERE id = $2", [comp.payload, comp.original_id]);
        }
      }
    }

    // Process Handlers
    const handlers = await client.query("SELECT * FROM Handlers WHERE change_batch_id = $1", [batchId]);
    for (const h of handlers.rows) {
      if (!h.original_id) {
        await client.query("UPDATE Handlers SET is_approved = true WHERE id = $1", [h.id]);
      } else {
        const orig = await getHandlerById(h.original_id);
        if (orig) {
          await client.query(
            "INSERT INTO Handlers (name, body, author_id, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false)",
            [orig.name, orig.body, orig.author_id, h.original_id, batchId]
          );
          await client.query("UPDATE Handlers SET body = $1, is_approved = true WHERE id = $2", [h.body, h.original_id]);
        }
      }
    }

    // Process Templates
    const templates = await client.query("SELECT * FROM Templates WHERE change_batch_id = $1", [batchId]);
    for (const t of templates.rows) {
      if (!t.original_id) {
        await client.query("UPDATE Templates SET is_approved = true WHERE id = $1", [t.id]);
      } else {
        const origRaw = await client.query("SELECT * FROM Templates WHERE id = $1", [t.original_id]);
        if (origRaw.rows.length > 0) {
          const raw = origRaw.rows[0];
          const archived = await client.query(
            "INSERT INTO Templates (author_id, group_id, payload, original_id, change_batch_id, is_approved) VALUES ($1, $2, $3, $4, $5, false) RETURNING id",
            [raw.author_id, raw.group_id, raw.payload, t.original_id, batchId]
          );
          const archivedId = archived.rows[0].id;
          
          // Copy original tags to the archived row
          await client.query("INSERT INTO TemplateTags (template_id, tag_id) SELECT $1, tag_id FROM TemplateTags WHERE template_id = $2", [archivedId, t.original_id]);

          // Update the original row with the new template payload
          await client.query("UPDATE Templates SET payload = $1, is_approved = true WHERE id = $2", [t.payload, t.original_id]);
          
          // Overwrite the original row's tags with the staged row's tags
          await client.query("DELETE FROM TemplateTags WHERE template_id = $1", [t.original_id]);
          await client.query("INSERT INTO TemplateTags (template_id, tag_id) SELECT $1, tag_id FROM TemplateTags WHERE template_id = $2", [t.original_id, t.id]);
        }
      }
    }

    // Process Content
    const contents = await client.query("SELECT * FROM Content WHERE change_batch_id = $1", [batchId]);
    for (const c of contents.rows) {
      if (!c.original_id) {
        await client.query("UPDATE Content SET is_visible = true WHERE id = $1", [c.id]);
      } else {
        const origRaw = await client.query("SELECT * FROM Content WHERE id = $1", [c.original_id]);
        if (origRaw.rows.length > 0) {
          const raw = origRaw.rows[0];
          const archived = await client.query(
            "INSERT INTO Content (author_id, payload, headers, is_visible, original_id, change_batch_id) VALUES ($1, $2, $3, false, $4, $5) RETURNING id",
            [raw.author_id, raw.payload, raw.headers, c.original_id, batchId]
          );
          const archivedId = archived.rows[0].id;

          // Copy original tags to the archived row
          await client.query("INSERT INTO ContentTags (content_id, tag_id) SELECT $1, tag_id FROM ContentTags WHERE content_id = $2", [archivedId, c.original_id]);

          // Update the original row with the new content payload and headers
          await client.query("UPDATE Content SET payload = $1, headers = $2, is_visible = true WHERE id = $3", [c.payload, c.headers, c.original_id]);
          
          // Overwrite the original row's tags with the staged row's tags
          await client.query("DELETE FROM ContentTags WHERE content_id = $1", [c.original_id]);
          await client.query("INSERT INTO ContentTags (content_id, tag_id) SELECT $1, tag_id FROM ContentTags WHERE content_id = $2", [c.original_id, c.id]);
        }
      }
    }

    await markChangeBatchMerged(batchId);
    
    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
