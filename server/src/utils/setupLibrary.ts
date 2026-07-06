import fs from 'fs';
import path from 'path';
import { Component } from '../models/component.js';
import { Content } from '../models/content.js';
import { Handler } from '../models/handler.js';
import { Template } from '../models/template.js';
import { Tag } from '../models/tag.js';
import { pgComponentSource } from '../sources/componentSource.js';
import { pgContentSource } from '../sources/contentSource.js';
import { pgHandlerSource } from '../sources/handlerSource.js';
import { pgTemplateSource } from '../sources/templateSource.js';
import { pgTagSource } from '../sources/tagSource.js';
import { logger } from './logger.js';
import { queryFirstRow } from './db.js';
import { pool } from '../db.js';

function extractReferences(payload: any) {
  const components = new Set<string>();
  const handlers = new Set<string>();

  const traverse = (node: any) => {
    if (!node) return;
    if (node.component && Array.isArray(node.component)) {
      for (const comp of node.component) {
        if (comp.reference) {
          if (comp.target && comp.target.startsWith('handlers.')) {
            handlers.add(comp.reference);
          } else {
            components.add(comp.reference);
          }
        }
      }
    }
    
    if (node.handlers) {
       for (const key of Object.keys(node.handlers)) {
         const val = node.handlers[key];
         if (typeof val === 'string' && val.trim().length > 0 && !val.trim().startsWith('(')) {
           handlers.add(val.trim());
         }
       }
    }

    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    } else if (node.content && typeof node.content === 'object') {
      traverse(node.content);
    }
  };

  traverse(payload);
  return { components: Array.from(components), handlers: Array.from(handlers) };
}

export async function loadLibraryData(adminUser: any) {
  const libraryPath = path.join(process.cwd(), 'library');
  
  // Create a default TemplateGroup for the dashboard/UI
  let groupId: number;
  const groupRow = await pool.query("INSERT INTO TemplateGroups (name) VALUES ('Default Group') ON CONFLICT DO NOTHING RETURNING id;");
  if (groupRow.rowCount && groupRow.rowCount > 0) {
    groupId = groupRow.rows[0].id;
  } else {
    const existingGroup = await pool.query("SELECT id FROM TemplateGroups WHERE name = 'Default Group';");
    groupId = existingGroup.rows[0].id;
  }

  // Load Handlers
  const handlersPath = path.join(libraryPath, 'handlers');
  if (fs.existsSync(handlersPath)) {
    const files = fs.readdirSync(handlersPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
      const name = path.basename(file, '.js');
      const body = fs.readFileSync(path.join(handlersPath, file), 'utf-8');
      
      const allHandlers = await Handler.getAll(pgHandlerSource, adminUser) as Handler[];
      const existing = allHandlers.find(h => h.name === name);
      
      if (existing && !('error' in existing)) {
        await (existing as Handler).update(adminUser, { name, body });
        await (existing as Handler).approve(adminUser, true);
      } else {
        const handlerRes = await Handler.create(pgHandlerSource, adminUser, { name, body });
        if (handlerRes && !('error' in handlerRes)) {
          await (handlerRes as any).handler.approve(adminUser, true);
        }
      }
    }
  }

  // Load Components
  const componentsPath = path.join(libraryPath, 'components');
  if (fs.existsSync(componentsPath)) {
    const files = fs.readdirSync(componentsPath).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const name = path.basename(file, '.json');
      const payload = JSON.parse(fs.readFileSync(path.join(componentsPath, file), 'utf-8'));
      
      const allComps = await Component.getAll(pgComponentSource, adminUser) as Component[];
      const existing = allComps.find(c => c.name === name);
      
      const refs = extractReferences(payload);
      let compId: number | undefined;

      if (existing && !('error' in existing)) {
        await (existing as Component).update(adminUser, { name, payload });
        compId = (existing as Component).id;
      } else {
        const res: any = await Component.create(pgComponentSource, adminUser, { name, payload });
        if (res && !res.error) {
          compId = res.component.id;
        }
      }

      if (compId !== undefined && (name === 'adminDashboardLink' || name === 'editContentLink')) {
        await pool.query("UPDATE Components SET approved_roles = $1 WHERE id = $2", [['admin'], compId]);
      }
      
      if (compId !== undefined && refs.handlers.length > 0) {
        await pool.query("DELETE FROM ComponentHandlers WHERE component_id = $1", [compId]);
        await pool.query(`
          INSERT INTO ComponentHandlers (component_id, handler_id)
          SELECT $1, id FROM Handlers WHERE name = ANY($2::text[])
        `, [compId, refs.handlers]);
      }
    }
  }

  // Load Templates
  const templatesPath = path.join(libraryPath, 'templates');
  if (fs.existsSync(templatesPath)) {
    const scanDir = async (dir: string, currentGroupId: number, tags: string[] = []) => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          let nextGroupId: number;
          const groupRow = await pool.query("INSERT INTO TemplateGroups (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id;", [item]);
          if (groupRow.rowCount && groupRow.rowCount > 0) {
            nextGroupId = groupRow.rows[0].id;
          } else {
            const existingGroup = await pool.query("SELECT id FROM TemplateGroups WHERE name = $1;", [item]);
            nextGroupId = existingGroup.rows[0].id;
          }
          await scanDir(fullPath, nextGroupId, [...tags, item.toLowerCase()]);
        } else if (item.endsWith('.json')) {
          const payload = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          const baseName = item.replace('.json', '');
          const itemTags = [...tags, 'structural', ...baseName.split('_').map(t => t.toLowerCase())];
          
          const tempRes: any = await Template.create(pgTemplateSource, adminUser.username, payload, [], currentGroupId);
          if (tempRes && !tempRes.error) {
            const temp = tempRes.template;
            // Add tags
            for (const tag of itemTags) {
              try {
                const tagRow = await pool.query("INSERT INTO Tags (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id;", [tag]);
                let tagId;
                if (tagRow.rowCount && tagRow.rowCount > 0) {
                  tagId = tagRow.rows[0].id;
                } else {
                  const existingTag = await pool.query("SELECT id FROM Tags WHERE name = $1;", [tag]);
                  if (existingTag.rowCount && existingTag.rowCount > 0) {
                    tagId = existingTag.rows[0].id;
                  }
                }
                if (tagId) {
                  await pool.query("INSERT INTO TemplateTags (template_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [temp.id, tagId]);
                }
              } catch (err) {
                logger.error({ err }, "Error inserting tag");
              }
            }
            
            const refs = extractReferences(payload);
            if (refs.components.length > 0) {
              await Component.updateTemplateComponents(pgComponentSource, null, temp.id, refs.components);
            }
            if (refs.handlers.length > 0) {
              await Handler.updateTemplateHandlers(pgHandlerSource, temp.id, refs.handlers);
            }
          }
        }
      }
    };
    await scanDir(templatesPath, groupId);
  }

  // Load Content (like Admin Dashboard, index etc.)
  const contentsPath = path.join(libraryPath, 'contents');
  if (fs.existsSync(contentsPath)) {
    const files = fs.readdirSync(contentsPath).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const payload = JSON.parse(fs.readFileSync(path.join(contentsPath, file), 'utf-8'));
      
      const contRes = await Content.create(pgContentSource, adminUser, payload, null, ['structural'], [], true, null);
      if (contRes && !('error' in contRes)) {
        const content = (contRes as any).content;
        await content.update(adminUser, payload, null, ['structural'], [], true, null);
        let targetGroupName = 'navSidebar';
        if (file === 'adminDashboard.json') {
           targetGroupName = 'navSidebarWithSidebar';
        }
        
        let targetGroupId = groupId;
        const targetGroupRow = await pool.query("SELECT id FROM TemplateGroups WHERE name = $1;", [targetGroupName]);
        if (targetGroupRow.rowCount && targetGroupRow.rowCount > 0) {
           targetGroupId = targetGroupRow.rows[0].id;
        }

        // Link to target group
        await pool.query("INSERT INTO ContentTemplateGroups (content_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [content.id, targetGroupId]);
        
        const refs = extractReferences(payload);
        if (refs.components.length > 0) {
          await Component.updateContentComponents(pgComponentSource, null, content.id, refs.components);
        }
        if (refs.handlers.length > 0) {
          await Handler.updateContentHandlers(pgHandlerSource, content.id, refs.handlers);
        }
        
        // If it's the admin dashboard, set the site setting
        if (file === 'adminDashboard.json') {
           await pool.query("INSERT INTO SiteSettings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['admin_dashboard_content_id', JSON.stringify({id: content.id})]);
        }
        
        // If it's the homepage, set it as the default index content
        if (file === 'homepage.json') {
           await pool.query("INSERT INTO SiteSettings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['default_index_content_id', JSON.stringify({id: content.id})]);
        }
      }
    }
  }

  logger.info("Library data successfully loaded into the database.");
}
