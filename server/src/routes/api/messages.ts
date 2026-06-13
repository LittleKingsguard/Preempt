import { Router } from 'express';
import { pgMessageSource, getMessageAuthor } from '../../sources/messageSource.js';
import { pgMessageListSource, getMessageListGroup, createMessageList } from '../../sources/messageListSource.js';
import { pgUserGroupSource } from '../../sources/userGroupSource.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = Router();

import { UserGroup } from '../../models/userGroup.js';
import { Content } from '../../models/content.js';

async function isUserInGroup(groupId: number, username: string) {
  const group = await UserGroup.getById(groupId);
  if ('error' in group) return false;
  const members = await group.getMembers();
  return members.some((m: any) => m.username === username);
}

// Create a UserGroup, add members, and create a MessageList
router.post('/create_chat', authenticateToken, async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { users, listName, groupName } = req.body;
  if (!users || !Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: "Users array is required" });
  }

  // Ensure current user is in the group
  const members = new Set(users);
  members.add(req.user.username);

  const finalGroupName = groupName || `Chat-${Date.now()}`;
  const groupRes = await pgUserGroupSource.create(finalGroupName);
  if ('error' in groupRes) return res.status(groupRes.status || 500).json(groupRes);

  const groupId = groupRes.id;
  await pgUserGroupSource.addMember(groupId, Array.from(members));

  const listRow = await createMessageList(groupId, listName);

  res.json({ messageList: listRow, group: groupRes });
});

// Create a MessageList for an existing group
router.post('/', authenticateToken, async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { group_id, listName } = req.body;
  if (!group_id) return res.status(400).json({ error: "group_id is required" });

  const inGroup = await isUserInGroup(group_id, req.user.username);
  if (!inGroup && !req.user.is_admin) {
    return res.status(403).json({ error: "Forbidden: You are not in this group" });
  }

  const listRow = await createMessageList(group_id, listName);

  res.json({ messageList: listRow });
});

// Get accessible message lists
router.get('/', authenticateToken, async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

  try {
    const lists = await Content.getLatest(pgMessageListSource, { list_id: req.user.username, limit, offset } as any, req.user);
    res.json(lists);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch message lists", details: error.message });
  }
});

// Get messages for a list
router.get('/:messageListId', authenticateToken, async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const messageListId = parseInt(req.params.messageListId);
  const groupId = await getMessageListGroup(messageListId);
  if (!groupId) return res.status(404).json({ error: "Message list not found" });

  const inGroup = await isUserInGroup(groupId, req.user.username);
  if (!inGroup && !req.user.is_admin) {
    return res.status(403).json({ error: "Forbidden: You are not in the group for this list" });
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

  const messages = await pgMessageSource.get({ 
    list_id: messageListId,
    limit,
    offset,
    hide_pattern: 'Overlook'
  });
  
  res.json(messages);
});

// Create a message
router.post('/:messageListId', authenticateToken, async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const messageListId = parseInt(req.params.messageListId);
  const { body, reply_target_id } = req.body;

  if (!body) return res.status(400).json({ error: "Body is required" });

  const groupId = await getMessageListGroup(messageListId);
  if (!groupId) return res.status(404).json({ error: "Message list not found" });

  const inGroup = await isUserInGroup(groupId, req.user.username);
  if (!inGroup && !req.user.is_admin) {
    return res.status(403).json({ error: "Forbidden: You are not in the group for this list" });
  }

  const result = await pgMessageSource.create(
    req.user.username,
    { message_list_id: messageListId, body, reply_target_id },
    null, true, null, [], []
  );
  
  res.json(result);
});

// Delete a message
router.delete('/:messageListId/:messageId', authenticateToken, async (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const messageListId = parseInt(req.params.messageListId);
  const messageId = parseInt(req.params.messageId);

  const groupId = await getMessageListGroup(messageListId);
  if (!groupId) return res.status(404).json({ error: "Message list not found" });

  const inGroup = await isUserInGroup(groupId, req.user.username);
  if (!inGroup && !req.user.is_admin) {
    return res.status(403).json({ error: "Forbidden: You are not in the group for this list" });
  }

  const authorId = await getMessageAuthor(messageId);
  if (!authorId) {
    return res.status(404).json({ error: "Message not found" });
  }

  if (authorId !== req.user.username && !req.user.is_admin) {
    return res.status(403).json({ error: "Forbidden: You can only delete your own messages" });
  }

  const deleted = await pgMessageSource.delete(messageId);
  if (deleted && 'error' in deleted) {
    return res.status(deleted.status || 500).json(deleted);
  }

  res.json({ success: true, deletedId: messageId });
});

export default router;
