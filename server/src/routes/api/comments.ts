import { Router } from 'express';
import { PreemptEvent } from '../../../../src/types/Event.js';
import { pgCommentSource, getCommentAuthor } from '../../sources/commentSource.js';
import { Content } from '../../models/content.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = Router();


// Get comments for a list
router.get('/:commentListId', authenticateToken, async (req: any, res) => {
  const commentListId = parseInt(req.params.commentListId);
  const context = await pgCommentSource.getSubjectContext!(new PreemptEvent('comment.getContext', { id: req.user?.username || 'system', type: 'process' }), commentListId);
  if (!context) {
    return res.status(404).json({ error: "Comment list not found" });
  }

  // Enforce view access based on subject
  if (context.subject_type === 'Content') {
    const contentRes = await Content.getById(undefined, context.subject_id, req.user);
    if ('error' in contentRes) {
      return res.status(contentRes.status || 500).json(contentRes);
    }
    const content = contentRes as Content;
    const now = new Date();
    const isPublic = content.is_visible && (!content.live_date || new Date(content.live_date) <= now);
    
    if (!isPublic && !content.hasViewAccess(req.user)) {
      return res.status(403).json({ error: "Forbidden: You do not have view access to this content" });
    }
  } else {
    return res.status(400).json({ error: "Unknown subject type" });
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

  const comments = await pgCommentSource.get(new PreemptEvent('comment.get', { id: req.user?.username || 'system', type: 'process' }), { 
    list_id: commentListId,
    limit,
    offset,
    hide_pattern: 'Overlook'
  });
  res.json(comments);
});

// Create a comment
router.post('/:commentListId', authenticateToken, async (req: any, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const commentListId = parseInt(req.params.commentListId);
  const { body, parent_comment_id, target_placement } = req.body;

  if (!body) return res.status(400).json({ error: "Body is required" });
  if ((parent_comment_id && target_placement) || (!parent_comment_id && !target_placement)) {
    return res.status(400).json({ error: "Provide exactly one of parent_comment_id or target_placement" });
  }

  const context = await pgCommentSource.getSubjectContext!(new PreemptEvent('comment.getContext', { id: req.user?.username || 'system', type: 'process' }), commentListId);
  if (!context) return res.status(404).json({ error: "Comment list not found" });

  if (context.subject_type === 'Content') {
    const contentRes = await Content.getById(undefined, context.subject_id, req.user);
    if ('error' in contentRes) return res.status(contentRes.status || 500).json(contentRes);
    
    const content = contentRes as Content;
    if (!content.hasCommentAccess(req.user)) {
      return res.status(403).json({ error: "Forbidden: You do not have comment access to this content" });
    }
  }

  const result = await pgCommentSource.create(
    new PreemptEvent('comment.create', { id: req.user?.username || 'system', type: 'process' }),
    req.user.username,
    { comment_list_id: commentListId, body, parent_comment_id, target_placement },
    null, true, null, [], []
  );

  if ('error' in result) {
    return res.status(result.status || 500).json(result);
  }
  res.status(201).json(result);
  } catch (err) {
    console.error('Error in POST /:commentListId:', err);
    res.status(500).json({ error: "Internal server error top level" });
  }
});

// Delete a comment
router.delete('/:commentListId/:commentId', authenticateToken, async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const commentListId = parseInt(req.params.commentListId);
  const commentId = parseInt(req.params.commentId);

  const context = await pgCommentSource.getSubjectContext!(new PreemptEvent('comment.getContext', { id: req.user?.username || 'system', type: 'process' }), commentListId);
  if (!context) return res.status(404).json({ error: "Comment list not found" });

  // Load the comment to check ownership
  const authorId = await getCommentAuthor(new PreemptEvent('comment.getAuthor', { id: req.user?.username || 'system', type: 'process' }), commentId);
  if (!authorId) {
    return res.status(404).json({ error: "Comment not found" });
  }

  // To delete: must be comment author OR have Admin / Owner permissions on the content
  let canDelete = false;
  if (req.user.is_admin || authorId === req.user.username) {
    canDelete = true;
  } else if (context.subject_type === 'Content') {
    const contentRes = await Content.getById(undefined, context.subject_id, req.user);
    if (!('error' in contentRes)) {
      const content = contentRes as Content;
      const userRole = content.users?.find(u => u.username === req.user.username)?.role;
      const userGroupIds = req.user.groups?.map((g: any) => g.id) || [];
      const groupRole = content.groups?.find(g => userGroupIds.includes(g.group_id))?.role;
      if (userRole === 'Owner' || groupRole === 'Owner') {
        canDelete = true;
      }
    }
  }

  if (!canDelete) {
    return res.status(403).json({ error: "Forbidden: You do not have permission to delete this comment" });
  }

  const result = await pgCommentSource.delete(new PreemptEvent('comment.delete', { id: req.user?.username || 'system', type: 'process' }), commentId);
  if ('error' in result) return res.status(result.status || 500).json(result);
  
  res.json({ success: true });
});

export default router;
