import "server-only";

import { ObjectId, Filter, Document } from "mongodb";
import { recordAudit } from "@/server/audit/audit.service";
import { withTransaction } from "@/server/db/transactions";
import { assertPermission, PERMISSIONS, type Permission } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import { AppError } from "@/shared/lib/errors";
import type {
  BlogPost,
  ContentCategory,
  ContentTag,
  ForumTopic,
  ForumReply,
  Comment,
  ChatConversation,
  ChatMessage,
  AISummary,
  AIReplySuggestion,
  CommunityDashboardStats,
  CommentTargetType,
} from "@/features/community/types";
import type {
  CreateBlogPostInput,
  UpdateBlogPostInput,
  CreateForumTopicInput,
  CreateForumReplyInput,
  CreateCommentInput,
  StartChatInput,
  SendChatMessageInput,
} from "@/features/community/schemas/community.schema";

const can = (ctx: WorkspaceContext, permission: Permission) => ctx.permissions.has(permission);

function audit(ctx: WorkspaceContext, action: string, entityType: string, entityId: string, metadata?: Record<string, string | number | boolean>, tx?: Parameters<typeof recordAudit>[2]) {
  return recordAudit(ctx.db, { companyId: ctx.companyId, actorUserId: ctx.userId, action, entityType, entityId, requestId: ctx.requestId, metadata }, tx);
}

function objectId(value: string, what: string): ObjectId {
  if (!ObjectId.isValid(value) || value.length !== 24) throw new AppError("NOT_FOUND", `${what} was not found.`);
  return new ObjectId(value);
}

function mapPost(doc: Document): BlogPost {
  return {
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    authorUserId: doc.authorUserId as string,
    authorName: doc.authorName as string,
    slug: doc.slug as string,
    title: doc.title as string,
    excerpt: doc.excerpt as string,
    body: doc.body as string,
    coverImage: doc.coverImage as string | undefined,
    status: doc.status as "draft" | "published" | "archived",
    categoryIds: (doc.categoryIds || []) as string[],
    tags: (doc.tags || []) as string[],
    readingTimeMinutes: doc.readingTimeMinutes || calculateReadingTime(doc.body || ""),
    publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : undefined,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    viewsCount: doc.viewsCount || 0,
    aiSummaryId: doc.aiSummaryId as string | undefined,
  };
}

function mapMessage(doc: Document): ChatMessage {
  return {
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    conversationId: doc.conversationId as string,
    senderUserId: doc.senderUserId as string | undefined,
    senderType: doc.senderType as "visitor" | "agent" | "bot" | "system",
    senderName: doc.senderName as string,
    body: doc.body as string,
    messageType: doc.messageType as "text" | "system" | "faq_answer",
    sentAt: new Date(doc.sentAt).toISOString(),
    editedAt: doc.editedAt ? new Date(doc.editedAt).toISOString() : undefined,
  };
}

function mapConversation(doc: Document): ChatConversation {
  return {
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    visitorUserId: doc.visitorUserId as string | undefined,
    visitorSessionId: doc.visitorSessionId as string,
    visitorName: doc.visitorName as string,
    visitorEmail: doc.visitorEmail as string | undefined,
    status: doc.status as "open" | "assigned" | "closed",
    channel: doc.channel as "web_widget" | "internal_support",
    assignedToUserId: doc.assignedToUserId as string | undefined,
    assignedToName: doc.assignedToName as string | undefined,
    startedAt: new Date(doc.startedAt).toISOString(),
    closedAt: doc.closedAt ? new Date(doc.closedAt).toISOString() : undefined,
    lastMessageAt: new Date(doc.lastMessageAt || doc.startedAt).toISOString(),
    unreadCount: doc.unreadCount || 0,
  };
}

/** Support agents see every conversation of the company. Anyone else sees only the conversations they started themselves. */
async function loadConversation(ctx: WorkspaceContext, conversationId: string): Promise<Document> {
  const doc = await ctx.db.collection("chat_conversations").findOne({ _id: objectId(conversationId, "Conversation"), companyId: ctx.companyId });
  if (!doc) throw new AppError("NOT_FOUND", "Conversation was not found.");
  if (!can(ctx, PERMISSIONS.COMMUNITY_SUPPORT) && doc.visitorUserId !== ctx.userId.toHexString()) {
    throw new AppError("NOT_FOUND", "Conversation was not found.");
  }
  return doc;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function calculateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ============================================================================
// SEEDING DEFAULTS
// ============================================================================

/**
 * Optional demo content (categories, tags, a sample article and topic). Never runs on its own: an owner or admin must ask
 * for it explicitly. A one-time marker makes it exactly-once even when two requests arrive together, and it never
 * touches a company that already has categories.
 */
export async function seedCommunityDemoData(ctx: WorkspaceContext): Promise<{ seeded: boolean }> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_ADMIN);
  const cId = ctx.companyId;
  const db = ctx.db;

  if ((await db.collection("content_categories").countDocuments({ companyId: cId })) > 0) return { seeded: false };
  try {
    await db.collection<{ _id: string; seq: number }>("counters").insertOne({ _id: `community_demo:${cId.toHexString()}`, seq: 1 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return { seeded: false };
    throw error;
  }

  const now = new Date();

  // 1. Default categories
  const defaultCategories = [
    {
      companyId: cId,
      name: "Announcements & News",
      slug: "announcements-news",
      description: "Company milestones, official announcements, and executive updates.",
      createdAt: now,
    },
    {
      companyId: cId,
      name: "Product & Releases",
      slug: "product-releases",
      description: "Feature deep dives, changelogs, and roadmap walkthroughs.",
      createdAt: now,
    },
    {
      companyId: cId,
      name: "Best Practices & Guides",
      slug: "best-practices-guides",
      description: "Tutorials, operational workflows, and operational efficiency guides.",
      createdAt: now,
    },
    {
      companyId: cId,
      name: "Community & Discussion",
      slug: "community-discussion",
      description: "Open community topics, feedback, and collaborative conversations.",
      createdAt: now,
    },
  ];

  const catResult = await db.collection("content_categories").insertMany(defaultCategories);
  const primaryCatId = catResult.insertedIds[0].toString();
  const discussionCatId = catResult.insertedIds[3].toString();

  // 2. Default tags
  await db.collection("content_tags").insertMany([
    { companyId: cId, name: "General", createdAt: now },
    { companyId: cId, name: "ERP", createdAt: now },
    { companyId: cId, name: "Operations", createdAt: now },
    { companyId: cId, name: "AI", createdAt: now },
  ]);

  // 3. Welcome Blog Post
  const starterPostTitle = "Welcome to our Company Knowledge Base & Blog";
  const starterPostBody = `### Welcome to AnOps Blogs & Community Hub!

This platform brings together company announcements, technical deep dives, customer guides, and interactive community discussions into one unified experience.

#### Key Highlights
- **Rich Publishing:** Draft, preview, and publish company knowledge with markdown formatting and tag classification.
- **AI-Powered Summarization:** Instant 3-bullet executive summaries generated by the integrated AnOps AI Master.
- **Community Forum:** Participate in transparent discussion threads with nested replies and moderation.
- **Real-Time Live Chat:** Omnichannel customer support widget with AI-assisted fallback response.

Feel free to browse published articles, leave comments below, or start a new thread in the forum!`;

  const blogPostDoc = {
    companyId: cId,
    authorUserId: "system",
    authorName: "AnOps Editor",
    slug: `${slugify(starterPostTitle)}-${Date.now().toString(36)}`,
    title: starterPostTitle,
    excerpt: "Discover the newly integrated blog, community forum, and real-time live support chat.",
    body: starterPostBody,
    coverImage: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80",
    status: "published" as const,
    categoryIds: [primaryCatId],
    tags: ["General", "ERP", "AI"],
    readingTimeMinutes: 2,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    viewsCount: 14,
  };

  const blogResult = await db.collection("blog_posts").insertOne(blogPostDoc);
  const starterPostId = blogResult.insertedId.toString();

  // 4. Starter Comment
  await db.collection("comments").insertOne({
    companyId: cId,
    authorUserId: "system",
    authorName: "Community Moderator",
    targetType: "blog_post" as const,
    targetId: starterPostId,
    body: "Welcome everyone! Feel free to comment or reach out if you have feedback on this article.",
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
  });

  // 5. Welcome Forum Topic
  const forumTopicDoc = {
    companyId: cId,
    authorUserId: "system",
    authorName: "Community Moderator",
    categoryId: discussionCatId,
    categoryName: "Community & Discussion",
    title: "Introduce Yourself & Share What You Are Building!",
    body: `Hello team! Welcome to the new Community Forum.

Use this thread to introduce your team, describe your daily operations, and share what features or automations you are looking forward to exploring in AnOps ERP.`,
    status: "open" as const,
    isPinned: true,
    viewsCount: 28,
    repliesCount: 1,
    lastReplyAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const topicResult = await db.collection("forum_topics").insertOne(forumTopicDoc);
  const starterTopicId = topicResult.insertedId.toString();

  // 6. Starter Forum Reply
  await db.collection("forum_replies").insertOne({
    companyId: cId,
    topicId: starterTopicId,
    authorUserId: "system",
    authorName: "Fatma (Module Lead)",
    parentReplyId: null,
    body: "Excited to launch this module! The AI summary generator and live chat FAQ bot are ready to assist.",
    status: "active" as const,
    upvotesCount: 3,
    createdAt: now,
    updatedAt: now,
  });
  await audit(ctx, "community.demo_data.seeded", "community", cId.toHexString());
  return { seeded: true };
}

// ============================================================================
// BLOG POSTS & CATEGORIES
// ============================================================================

export async function getCategories(ctx: WorkspaceContext): Promise<ContentCategory[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;
  const docs = await db
    .collection("content_categories")
    .find({ companyId: cId })
    .sort({ name: 1 })
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    name: doc.name as string,
    slug: doc.slug as string,
    description: doc.description as string | undefined,
    createdAt: (doc.createdAt as Date).toISOString(),
  }));
}

export async function getTags(ctx: WorkspaceContext): Promise<ContentTag[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;
  const docs = await db
    .collection("content_tags")
    .find({ companyId: cId })
    .sort({ name: 1 })
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    name: doc.name as string,
    createdAt: (doc.createdAt as Date).toISOString(),
  }));
}

/** Lists are bounded: a page, or at most this many rows when the caller does not ask for one. */
export const DEFAULT_LIST_LIMIT = 200;
export type ListPage = { skip: number; limit: number };

function postQuery(ctx: WorkspaceContext, filter?: { status?: string; categoryId?: string; search?: string }): Filter<Document> {
  const cId = ctx.companyId;
  const query: Filter<Document> = { companyId: cId };

  // Drafts and archived articles are working material: read-only members see published articles only.
  if (!can(ctx, PERMISSIONS.COMMUNITY_WRITE)) {
    query.status = "published";
  } else if (filter?.status && filter.status !== "all") {
    query.status = filter.status;
  }
  if (filter?.categoryId && filter.categoryId !== "all") {
    query.categoryIds = filter.categoryId;
  }
  if (filter?.search) {
    const regex = new RegExp(filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ title: regex }, { excerpt: regex }, { tags: regex }];
  }
  return query;
}

export async function countBlogPosts(ctx: WorkspaceContext, filter?: { status?: string; categoryId?: string; search?: string }): Promise<number> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  return ctx.db.collection("blog_posts").countDocuments(postQuery(ctx, filter));
}

export async function getBlogPosts(
  ctx: WorkspaceContext,
  filter?: { status?: string; categoryId?: string; search?: string },
  page?: ListPage
): Promise<BlogPost[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const db = ctx.db;

  const docs = await db
    .collection("blog_posts")
    .find(postQuery(ctx, filter))
    .sort({ publishedAt: -1, createdAt: -1 })
    .skip(page?.skip ?? 0)
    .limit(page?.limit ?? DEFAULT_LIST_LIMIT)
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    authorUserId: doc.authorUserId as string,
    authorName: doc.authorName as string,
    slug: doc.slug as string,
    title: doc.title as string,
    excerpt: doc.excerpt as string,
    body: doc.body as string,
    coverImage: doc.coverImage as string | undefined,
    status: doc.status as "draft" | "published" | "archived",
    categoryIds: (doc.categoryIds || []) as string[],
    tags: (doc.tags || []) as string[],
    readingTimeMinutes: doc.readingTimeMinutes || calculateReadingTime(doc.body || ""),
    publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : undefined,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    viewsCount: doc.viewsCount || 0,
    aiSummaryId: doc.aiSummaryId as string | undefined,
  }));
}

export async function getBlogPostByIdOrSlug(
  ctx: WorkspaceContext,
  idOrSlug: string,
  options: { countView?: boolean } = {}
): Promise<BlogPost | null> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;

  const isObjId = ObjectId.isValid(idOrSlug) && idOrSlug.length === 24;
  const filter: Filter<Document> = {
    companyId: cId,
    ...(isObjId ? { _id: new ObjectId(idOrSlug) } : { slug: idOrSlug }),
    ...(can(ctx, PERMISSIONS.COMMUNITY_WRITE) ? {} : { status: "published" }),
  };

  const doc = await db.collection("blog_posts").findOne(filter);
  if (!doc) return null;

  // Reading for a person counts a view; reading for the assistant does not change anything.
  const counted = options.countView !== false;
  if (counted) db.collection("blog_posts").updateOne({ _id: doc._id }, { $inc: { viewsCount: 1 } }).catch(() => {});

  return {
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    authorUserId: doc.authorUserId as string,
    authorName: doc.authorName as string,
    slug: doc.slug as string,
    title: doc.title as string,
    excerpt: doc.excerpt as string,
    body: doc.body as string,
    coverImage: doc.coverImage as string | undefined,
    status: doc.status as "draft" | "published" | "archived",
    categoryIds: (doc.categoryIds || []) as string[],
    tags: (doc.tags || []) as string[],
    readingTimeMinutes: doc.readingTimeMinutes || calculateReadingTime(doc.body || ""),
    publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : undefined,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    viewsCount: (doc.viewsCount || 0) + (counted ? 1 : 0),
    aiSummaryId: doc.aiSummaryId as string | undefined,
  };
}

export async function createBlogPost(ctx: WorkspaceContext, input: CreateBlogPostInput, authorName: string): Promise<BlogPost> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_WRITE);
  // New articles start as drafts. Publishing is an administrator decision (see publishBlogPost).
  if (input.status !== "draft") assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_ADMIN);

  const now = new Date();
  const uniqueSlug = `${slugify(input.title)}-${Date.now().toString(36)}`;
  const doc = {
    companyId: ctx.companyId,
    authorUserId: ctx.userId.toHexString(),
    authorName,
    slug: uniqueSlug,
    title: input.title,
    excerpt: input.excerpt || input.body.slice(0, 160).trim() + "...",
    body: input.body,
    coverImage: input.coverImage || undefined,
    status: input.status,
    categoryIds: input.categoryIds,
    tags: input.tags,
    readingTimeMinutes: calculateReadingTime(input.body),
    publishedAt: input.status === "published" ? now : undefined,
    createdAt: now,
    updatedAt: now,
    viewsCount: 0,
  };
  const result = await ctx.db.collection("blog_posts").insertOne(doc);
  await audit(ctx, "community.post.created", "community_post", result.insertedId.toHexString(), { status: input.status });
  return mapPost({ _id: result.insertedId, ...doc });
}

/**
 * Edits an article. Operators may edit drafts only and cannot change the status; changing a published or archived
 * article, and every status change, needs the administrator permission. `expectedUpdatedAt` makes the edit
 * conditional: it is applied only when nobody changed the article since it was read.
 */
export async function updateBlogPost(
  ctx: WorkspaceContext,
  input: UpdateBlogPostInput,
  options: { expectedUpdatedAt?: string } = {}
): Promise<BlogPost | null> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_WRITE);
  if (!ObjectId.isValid(input.id)) return null;
  const pId = new ObjectId(input.id);
  const posts = ctx.db.collection("blog_posts");

  const current = await posts.findOne({ _id: pId, companyId: ctx.companyId });
  if (!current) return null;

  const statusChange = input.status !== undefined && input.status !== current.status;
  if (statusChange || current.status !== "draft") assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_ADMIN);

  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) updateFields.title = input.title;
  if (input.excerpt !== undefined) updateFields.excerpt = input.excerpt;
  if (input.body !== undefined) {
    updateFields.body = input.body;
    updateFields.readingTimeMinutes = calculateReadingTime(input.body);
  }
  if (input.coverImage !== undefined) updateFields.coverImage = input.coverImage || undefined;
  if (input.categoryIds !== undefined) updateFields.categoryIds = input.categoryIds;
  if (input.tags !== undefined) updateFields.tags = input.tags;
  if (statusChange) {
    updateFields.status = input.status;
    if (input.status === "published") updateFields.publishedAt = new Date();
  }

  const guard: Document = { _id: pId, companyId: ctx.companyId, updatedAt: current.updatedAt, status: current.status };
  if (options.expectedUpdatedAt && new Date(options.expectedUpdatedAt).getTime() !== new Date(current.updatedAt).getTime()) {
    throw new AppError("CONFLICT", "This article changed after you reviewed it. Review it again.");
  }
  const result = await posts.findOneAndUpdate(guard, { $set: updateFields }, { returnDocument: "after" });
  if (!result) throw new AppError("CONFLICT", "This article changed while it was being saved. Try again.");

  await audit(ctx, statusChange ? `community.post.${input.status}` : "community.post.updated", "community_post", pId.toHexString(), {
    fromStatus: String(current.status),
    toStatus: String(result.status),
  });
  return mapPost(result);
}

export async function deleteBlogPost(ctx: WorkspaceContext, postId: string): Promise<boolean> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_ADMIN);
  if (!ObjectId.isValid(postId)) return false;
  const id = new ObjectId(postId);
  // The article, its comments and its summaries go together or not at all.
  return withTransaction(ctx.db, async (tx) => {
    const options = { session: tx.session };
    const removed = await ctx.db.collection("blog_posts").findOneAndDelete({ _id: id, companyId: ctx.companyId }, options);
    if (!removed) return false;
    await ctx.db.collection("comments").deleteMany({ targetType: "blog_post", targetId: postId, companyId: ctx.companyId }, options);
    await ctx.db.collection("ai_summaries").deleteMany({ blogPostId: postId, companyId: ctx.companyId }, options);
    await audit(ctx, "community.post.deleted", "community_post", postId, { status: String(removed.status) }, tx);
    return true;
  });
}

// ============================================================================
// COMMUNITY FORUM
// ============================================================================

function topicQuery(ctx: WorkspaceContext, filter?: { categoryId?: string; search?: string }): Filter<Document> {
  const query: Filter<Document> = { companyId: ctx.companyId };
  if (filter?.categoryId && filter.categoryId !== "all") {
    query.categoryId = filter.categoryId;
  }
  if (filter?.search) {
    const regex = new RegExp(filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ title: regex }, { body: regex }];
  }
  return query;
}

export async function countForumTopics(ctx: WorkspaceContext, filter?: { categoryId?: string; search?: string }): Promise<number> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  return ctx.db.collection("forum_topics").countDocuments(topicQuery(ctx, filter));
}

export async function getForumTopics(
  ctx: WorkspaceContext,
  filter?: { categoryId?: string; search?: string },
  page?: ListPage
): Promise<ForumTopic[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const db = ctx.db;

  const docs = await db
    .collection("forum_topics")
    .find(topicQuery(ctx, filter))
    .sort({ isPinned: -1, lastReplyAt: -1, createdAt: -1 })
    .skip(page?.skip ?? 0)
    .limit(page?.limit ?? DEFAULT_LIST_LIMIT)
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    authorUserId: doc.authorUserId as string,
    authorName: doc.authorName as string,
    categoryId: doc.categoryId as string | undefined,
    categoryName: doc.categoryName as string | undefined,
    title: doc.title as string,
    body: doc.body as string,
    status: doc.status as "open" | "locked" | "archived",
    isPinned: Boolean(doc.isPinned),
    viewsCount: doc.viewsCount || 0,
    repliesCount: doc.repliesCount || 0,
    lastReplyAt: doc.lastReplyAt ? new Date(doc.lastReplyAt).toISOString() : undefined,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }));
}

export async function getForumTopicById(
  ctx: WorkspaceContext,
  topicId: string,
  options: { countView?: boolean } = {}
): Promise<ForumTopic | null> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;

  if (!ObjectId.isValid(topicId)) return null;

  const doc = await db.collection("forum_topics").findOne({
    _id: new ObjectId(topicId),
    companyId: cId,
  });

  if (!doc) return null;

  if (options.countView !== false) db.collection("forum_topics").updateOne({ _id: doc._id }, { $inc: { viewsCount: 1 } }).catch(() => {});

  return {
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    authorUserId: doc.authorUserId as string,
    authorName: doc.authorName as string,
    categoryId: doc.categoryId as string | undefined,
    categoryName: doc.categoryName as string | undefined,
    title: doc.title as string,
    body: doc.body as string,
    status: doc.status as "open" | "locked" | "archived",
    isPinned: Boolean(doc.isPinned),
    viewsCount: (doc.viewsCount || 0) + (options.countView !== false ? 1 : 0),
    repliesCount: doc.repliesCount || 0,
    lastReplyAt: doc.lastReplyAt ? new Date(doc.lastReplyAt).toISOString() : undefined,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

export async function createForumTopic(ctx: WorkspaceContext, input: CreateForumTopicInput, authorName: string): Promise<ForumTopic> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_WRITE);
  // Pinning is a moderation decision.
  if (input.isPinned) assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_ADMIN);

  let categoryName: string | undefined;
  if (input.categoryId) {
    const cat = await ctx.db.collection("content_categories").findOne({ _id: objectId(input.categoryId, "Category"), companyId: ctx.companyId });
    if (!cat) throw new AppError("VALIDATION_ERROR", "That category does not exist.", { categoryId: "Choose an existing category." });
    categoryName = cat.name as string;
  }

  const now = new Date();
  const doc = {
    companyId: ctx.companyId,
    authorUserId: ctx.userId.toHexString(),
    authorName,
    categoryId: input.categoryId || undefined,
    categoryName,
    title: input.title,
    body: input.body,
    status: "open" as const,
    isPinned: Boolean(input.isPinned),
    viewsCount: 0,
    repliesCount: 0,
    lastReplyAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const result = await ctx.db.collection("forum_topics").insertOne(doc);
  await audit(ctx, "community.topic.created", "community_topic", result.insertedId.toHexString());
  return {
    id: result.insertedId.toString(),
    companyId: ctx.companyId.toString(),
    authorUserId: doc.authorUserId,
    authorName,
    categoryId: doc.categoryId,
    categoryName,
    title: doc.title,
    body: doc.body,
    status: "open",
    isPinned: doc.isPinned,
    viewsCount: 0,
    repliesCount: 0,
    lastReplyAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function togglePinTopic(ctx: WorkspaceContext, topicId: string): Promise<boolean> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_ADMIN);
  if (!ObjectId.isValid(topicId)) return false;
  // One atomic flip: two moderators pinning together cannot both read "unpinned" and write the same value.
  const flipped = await ctx.db
    .collection("forum_topics")
    .findOneAndUpdate({ _id: new ObjectId(topicId), companyId: ctx.companyId }, [{ $set: { isPinned: { $not: ["$isPinned"] }, updatedAt: "$$NOW" } }], { returnDocument: "after" });
  if (!flipped) return false;
  await audit(ctx, flipped.isPinned ? "community.topic.pinned" : "community.topic.unpinned", "community_topic", topicId);
  return Boolean(flipped.isPinned);
}

export async function getForumReplies(ctx: WorkspaceContext, topicId: string): Promise<ForumReply[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;

  const docs = await db
    .collection("forum_replies")
    .find({ topicId, companyId: cId, status: "active" })
    .sort({ createdAt: 1 })
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    topicId: doc.topicId as string,
    authorUserId: doc.authorUserId as string,
    authorName: doc.authorName as string,
    parentReplyId: doc.parentReplyId as string | null | undefined,
    body: doc.body as string,
    status: doc.status as "active" | "hidden",
    upvotesCount: doc.upvotesCount || 0,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }));
}

/** Sets the pin to an explicit value, and only if the topic is not already in that state (so a stale request changes nothing). */
export async function setTopicPinned(ctx: WorkspaceContext, topicId: string, pinned: boolean): Promise<boolean> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_ADMIN);
  if (!ObjectId.isValid(topicId)) return false;
  const changed = await ctx.db
    .collection("forum_topics")
    .findOneAndUpdate({ _id: new ObjectId(topicId), companyId: ctx.companyId, isPinned: pinned ? { $ne: true } : true }, { $set: { isPinned: pinned, updatedAt: new Date() } });
  if (!changed) return false;
  await audit(ctx, pinned ? "community.topic.pinned" : "community.topic.unpinned", "community_topic", topicId);
  return true;
}

export async function createForumReply(ctx: WorkspaceContext, input: CreateForumReplyInput, authorName: string): Promise<ForumReply> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_WRITE);
  const topicId = objectId(input.topicId, "Topic");
  const topic = await ctx.db.collection("forum_topics").findOne({ _id: topicId, companyId: ctx.companyId });
  if (!topic) throw new AppError("NOT_FOUND", "Topic was not found.");
  if (topic.status !== "open") throw new AppError("INVALID_TRANSITION", "This topic is closed to new replies.");
  if (input.parentReplyId) {
    const parent = await ctx.db.collection("forum_replies").findOne({ _id: objectId(input.parentReplyId, "Reply"), companyId: ctx.companyId, topicId: input.topicId });
    if (!parent) throw new AppError("NOT_FOUND", "The reply you answered was not found.");
  }

  const now = new Date();
  const doc = {
    companyId: ctx.companyId,
    topicId: input.topicId,
    authorUserId: ctx.userId.toHexString(),
    authorName,
    parentReplyId: input.parentReplyId || null,
    body: input.body,
    status: "active" as const,
    upvotesCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const result = await ctx.db.collection("forum_replies").insertOne(doc);
  await ctx.db
    .collection("forum_topics")
    .updateOne({ _id: topicId, companyId: ctx.companyId }, { $inc: { repliesCount: 1 }, $set: { lastReplyAt: now, updatedAt: now } });
  await audit(ctx, "community.reply.created", "community_topic", input.topicId);
  return {
    id: result.insertedId.toString(),
    companyId: ctx.companyId.toString(),
    topicId: input.topicId,
    authorUserId: doc.authorUserId,
    authorName,
    parentReplyId: doc.parentReplyId,
    body: doc.body,
    status: "active",
    upvotesCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

// ============================================================================
// COMMENTS ENGINE (Polymorphic: blog_post | forum_topic)
// ============================================================================

export async function getComments(
  ctx: WorkspaceContext,
  targetType: CommentTargetType,
  targetId: string
): Promise<Comment[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;

  const docs = await db
    .collection("comments")
    .find({
      companyId: cId,
      targetType,
      targetId,
      status: "active",
    })
    .sort({ createdAt: -1 })
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    authorUserId: doc.authorUserId as string,
    authorName: doc.authorName as string,
    targetType: doc.targetType as CommentTargetType,
    targetId: doc.targetId as string,
    body: doc.body as string,
    status: doc.status as "active" | "hidden",
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  }));
}

export async function createComment(ctx: WorkspaceContext, input: CreateCommentInput, authorName: string): Promise<Comment> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_WRITE);
  const collection = input.targetType === "blog_post" ? "blog_posts" : "forum_topics";
  const target = await ctx.db.collection(collection).findOne({ _id: objectId(input.targetId, "The item you commented on"), companyId: ctx.companyId }, { projection: { _id: 1 } });
  if (!target) throw new AppError("NOT_FOUND", "The item you commented on was not found.");

  const now = new Date();
  const doc = {
    companyId: ctx.companyId,
    authorUserId: ctx.userId.toHexString(),
    authorName,
    targetType: input.targetType,
    targetId: input.targetId,
    body: input.body,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
  };
  const result = await ctx.db.collection("comments").insertOne(doc);
  return {
    id: result.insertedId.toString(),
    companyId: ctx.companyId.toString(),
    authorUserId: doc.authorUserId,
    authorName,
    targetType: input.targetType,
    targetId: input.targetId,
    body: input.body,
    status: "active",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Authors may remove their own comment; removing anyone else's is moderation and needs the administrator permission. */
export async function deleteComment(ctx: WorkspaceContext, commentId: string): Promise<boolean> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  if (!ObjectId.isValid(commentId)) return false;
  const filter: Document = { _id: new ObjectId(commentId), companyId: ctx.companyId };
  if (!can(ctx, PERMISSIONS.COMMUNITY_ADMIN)) {
    assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_WRITE);
    filter.authorUserId = ctx.userId.toHexString();
  }
  const result = await ctx.db.collection("comments").deleteOne(filter);
  if (result.deletedCount > 0) await audit(ctx, "community.comment.deleted", "community_comment", commentId);
  return result.deletedCount > 0;
}

// ============================================================================
// LIVE SUPPORT CHAT
// ============================================================================

function chatQuery(ctx: WorkspaceContext, statusFilter?: string): Filter<Document> {
  const query: Filter<Document> = { companyId: ctx.companyId };
  if (!can(ctx, PERMISSIONS.COMMUNITY_SUPPORT)) query.visitorUserId = ctx.userId.toHexString();
  if (statusFilter && statusFilter !== "all") query.status = statusFilter;
  return query;
}

export async function countChatConversations(ctx: WorkspaceContext, statusFilter?: string): Promise<number> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  return ctx.db.collection("chat_conversations").countDocuments(chatQuery(ctx, statusFilter));
}

export async function getChatConversations(ctx: WorkspaceContext, statusFilter?: string, page?: ListPage): Promise<ChatConversation[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const docs = await ctx.db
    .collection("chat_conversations")
    .find(chatQuery(ctx, statusFilter))
    .sort({ lastMessageAt: -1 })
    .skip(page?.skip ?? 0)
    .limit(page?.limit ?? DEFAULT_LIST_LIMIT)
    .toArray();
  return docs.map(mapConversation);
}

export async function getChatConversationById(ctx: WorkspaceContext, conversationId: string): Promise<ChatConversation | null> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  if (!ObjectId.isValid(conversationId)) return null;
  try {
    return mapConversation(await loadConversation(ctx, conversationId));
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function startChatConversation(
  ctx: WorkspaceContext,
  input: StartChatInput
): Promise<{ conversation: ChatConversation; firstMessage: ChatMessage }> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const now = new Date();
  const visitorUserId = ctx.userId.toHexString();
  const convDoc = {
    companyId: ctx.companyId,
    visitorUserId,
    visitorSessionId: `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    visitorName: input.visitorName,
    visitorEmail: input.visitorEmail || undefined,
    status: "open" as const,
    channel: input.channel,
    startedAt: now,
    lastMessageAt: now,
    unreadCount: 1,
  };
  const convResult = await ctx.db.collection("chat_conversations").insertOne(convDoc);
  const conversationId = convResult.insertedId.toHexString();
  const msgDoc = {
    companyId: ctx.companyId,
    conversationId,
    senderUserId: visitorUserId,
    senderType: "visitor" as const,
    senderName: input.visitorName,
    body: input.initialMessage,
    messageType: "text" as const,
    sentAt: now,
  };
  const msgResult = await ctx.db.collection("chat_messages").insertOne(msgDoc);
  return { conversation: mapConversation({ _id: convResult.insertedId, ...convDoc }), firstMessage: mapMessage({ _id: msgResult.insertedId, ...msgDoc }) };
}

export async function getChatMessages(ctx: WorkspaceContext, conversationId: string, afterTimestamp?: string): Promise<ChatMessage[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  await loadConversation(ctx, conversationId);
  const filter: Filter<Document> = { companyId: ctx.companyId, conversationId };
  if (afterTimestamp) filter.sentAt = { $gt: new Date(afterTimestamp) };
  const docs = await ctx.db.collection("chat_messages").find(filter).sort({ sentAt: 1 }).toArray();
  return docs.map(mapMessage);
}

async function appendMessage(
  ctx: WorkspaceContext,
  conversation: Document,
  message: { senderType: "visitor" | "agent" | "bot" | "system"; senderUserId?: string; senderName: string; body: string; messageType: "text" | "system" | "faq_answer" }
): Promise<ChatMessage> {
  if (conversation.status === "closed") throw new AppError("INVALID_TRANSITION", "This conversation is closed.");
  const now = new Date();
  const doc = { companyId: ctx.companyId, conversationId: conversation._id.toHexString(), senderUserId: message.senderUserId, senderType: message.senderType, senderName: message.senderName, body: message.body, messageType: message.messageType, sentAt: now };
  const result = await ctx.db.collection("chat_messages").insertOne(doc);
  await ctx.db.collection("chat_conversations").updateOne(
    { _id: conversation._id, companyId: ctx.companyId },
    message.senderType === "visitor" ? { $set: { lastMessageAt: now }, $inc: { unreadCount: 1 } } : { $set: { lastMessageAt: now, unreadCount: 0 } }
  );
  return mapMessage({ _id: result.insertedId, ...doc });
}

/**
 * Posts a message as the signed-in person. The role in the message comes from the server, never from the request:
 * the person who started the conversation writes as the visitor, a support agent writes as an agent, and nobody
 * can post as the bot or the system from here.
 */
export async function sendChatMessage(ctx: WorkspaceContext, input: SendChatMessageInput, senderName: string): Promise<ChatMessage> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const conversation = await loadConversation(ctx, input.conversationId);
  const isVisitor = conversation.visitorUserId === ctx.userId.toHexString();
  if (!isVisitor) assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_SUPPORT);
  return appendMessage(ctx, conversation, {
    senderType: isVisitor ? "visitor" : "agent",
    senderUserId: ctx.userId.toHexString(),
    senderName,
    body: input.body,
    messageType: "text",
  });
}

/** The fallback support bot's reply. Server-side only (never reachable from a request field); needs the support permission. */
export async function postBotMessage(ctx: WorkspaceContext, conversationId: string, body: string): Promise<ChatMessage> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const conversation = await loadConversation(ctx, conversationId);
  const isVisitor = conversation.visitorUserId === ctx.userId.toHexString();
  if (!isVisitor) assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_SUPPORT);
  return appendMessage(ctx, conversation, { senderType: "bot", senderName: "AnOps Support Bot", body, messageType: "faq_answer" });
}

export async function closeChatConversation(ctx: WorkspaceContext, conversationId: string): Promise<boolean> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_SUPPORT);
  if (!ObjectId.isValid(conversationId)) return false;
  // Only an open conversation can be closed, and only once.
  const result = await ctx.db
    .collection("chat_conversations")
    .updateOne({ _id: new ObjectId(conversationId), companyId: ctx.companyId, status: { $ne: "closed" } }, { $set: { status: "closed", closedAt: new Date() } });
  if (result.modifiedCount > 0) await audit(ctx, "community.chat.closed", "community_chat", conversationId);
  return result.modifiedCount > 0;
}

// ============================================================================
// AI SUMMARIES & SUGGESTIONS
// ============================================================================

export async function getAISummariesForPost(
  ctx: WorkspaceContext,
  blogPostId: string
): Promise<AISummary[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;

  const docs = await db
    .collection("ai_summaries")
    .find({ companyId: cId, blogPostId })
    .sort({ generatedAt: -1 })
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    blogPostId: doc.blogPostId as string,
    requestedBy: doc.requestedBy as string,
    summary: doc.summary as string,
    bulletPoints: (doc.bulletPoints || []) as string[],
    status: doc.status as "pending" | "completed" | "failed",
    modelVersion: doc.modelVersion as string,
    generatedAt: new Date(doc.generatedAt).toISOString(),
  }));
}

export async function saveAISummary(
  ctx: WorkspaceContext,
  data: {
    blogPostId: string;
    summary: string;
    bulletPoints: string[];
    modelVersion: string;
  }
): Promise<AISummary> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_WRITE);
  const cId = ctx.companyId;
  const db = ctx.db;

  const post = await db.collection("blog_posts").findOne({ _id: objectId(data.blogPostId, "Article"), companyId: cId }, { projection: { _id: 1 } });
  if (!post) throw new AppError("NOT_FOUND", "Article was not found.");

  const now = new Date();
  const doc = {
    companyId: cId,
    blogPostId: data.blogPostId,
    requestedBy: ctx.userId.toHexString(),
    summary: data.summary,
    bulletPoints: data.bulletPoints,
    status: "completed" as const,
    modelVersion: data.modelVersion,
    generatedAt: now,
  };

  const result = await db.collection("ai_summaries").insertOne(doc);

  // Link to blog post
  if (ObjectId.isValid(data.blogPostId)) {
    await db.collection("blog_posts").updateOne(
      { _id: new ObjectId(data.blogPostId), companyId: cId },
      { $set: { aiSummaryId: result.insertedId.toString() } }
    );
  }

  return {
    id: result.insertedId.toString(),
    companyId: cId.toString(),
    blogPostId: data.blogPostId,
    requestedBy: ctx.userId.toHexString(),
    summary: data.summary,
    bulletPoints: data.bulletPoints,
    status: "completed",
    modelVersion: data.modelVersion,
    generatedAt: now.toISOString(),
  };
}

export async function getAIReplySuggestions(
  ctx: WorkspaceContext,
  conversationId: string
): Promise<AIReplySuggestion[]> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_SUPPORT);
  const cId = ctx.companyId;
  const db = ctx.db;

  const docs = await db
    .collection("ai_reply_suggestions")
    .find({ companyId: cId, conversationId, status: "suggested" })
    .sort({ generatedAt: -1 })
    .limit(3)
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    companyId: doc.companyId.toString(),
    conversationId: doc.conversationId as string,
    sourceMessageId: doc.sourceMessageId as string | undefined,
    suggestedText: doc.suggestedText as string,
    status: doc.status as "suggested" | "sent" | "discarded",
    reviewedBy: doc.reviewedBy as string | undefined,
    generatedAt: new Date(doc.generatedAt).toISOString(),
  }));
}

export async function saveAIReplySuggestion(
  ctx: WorkspaceContext,
  data: {
    conversationId: string;
    sourceMessageId?: string;
    suggestedText: string;
  }
): Promise<AIReplySuggestion> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_SUPPORT);
  const cId = ctx.companyId;
  const db = ctx.db;

  await loadConversation(ctx, data.conversationId);

  const now = new Date();
  const doc = {
    companyId: cId,
    conversationId: data.conversationId,
    sourceMessageId: data.sourceMessageId || undefined,
    suggestedText: data.suggestedText,
    status: "suggested" as const,
    generatedAt: now,
  };

  const result = await db.collection("ai_reply_suggestions").insertOne(doc);

  return {
    id: result.insertedId.toString(),
    companyId: cId.toString(),
    conversationId: data.conversationId,
    sourceMessageId: data.sourceMessageId,
    suggestedText: data.suggestedText,
    status: "suggested",
    generatedAt: now.toISOString(),
  };
}

// ============================================================================
// DASHBOARD STATS
// ============================================================================

export async function getCommunityDashboardStats(
  ctx: WorkspaceContext
): Promise<CommunityDashboardStats> {
  assertPermission(ctx.permissions, PERMISSIONS.COMMUNITY_READ);
  const cId = ctx.companyId;
  const db = ctx.db;

  // What a member may see is what a member may count: read-only members count published articles only, and everyone
  // but support agents counts only their own conversations.
  const canWrite = can(ctx, PERMISSIONS.COMMUNITY_WRITE);
  const postScope: Document = canWrite ? { companyId: cId } : { companyId: cId, status: "published" };
  const chatScope: Document = can(ctx, PERMISSIONS.COMMUNITY_SUPPORT) ? { companyId: cId } : { companyId: cId, visitorUserId: ctx.userId.toHexString() };
  const [
    totalPosts,
    publishedPosts,
    draftPosts,
    totalTopics,
    totalReplies,
    openChats,
    totalComments,
    aiSummaries,
  ] = await Promise.all([
    db.collection("blog_posts").countDocuments(postScope),
    db.collection("blog_posts").countDocuments({ companyId: cId, status: "published" }),
    canWrite ? db.collection("blog_posts").countDocuments({ companyId: cId, status: "draft" }) : Promise.resolve(0),
    db.collection("forum_topics").countDocuments({ companyId: cId }),
    db.collection("forum_replies").countDocuments({ companyId: cId }),
    db.collection("chat_conversations").countDocuments({ ...chatScope, status: "open" }),
    db.collection("comments").countDocuments({ companyId: cId }),
    canWrite ? db.collection("ai_summaries").countDocuments({ companyId: cId }) : Promise.resolve(0),
  ]);

  return {
    totalBlogPosts: totalPosts,
    publishedBlogPosts: publishedPosts,
    draftBlogPosts: draftPosts,
    totalForumTopics: totalTopics,
    totalForumReplies: totalReplies,
    openChatConversations: openChats,
    totalComments: totalComments,
    aiSummariesGenerated: aiSummaries,
  };
}
