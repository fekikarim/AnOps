import { z } from "zod";

/**
 * Community Validation Schemas (Zod)
 * Validates inputs at trust boundaries (Server Actions & Route Handlers)
 */

export const blogPostStatusSchema = z.enum(["draft", "published", "archived"]);

export const createBlogPostSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(150, "Title must be under 150 characters"),
  excerpt: z
    .string()
    .trim()
    .max(350, "Excerpt must be under 350 characters")
    .default(""),
  body: z
    .string()
    .trim()
    .min(10, "Article content must be at least 10 characters")
    .max(50000, "Article content must be under 50,000 characters"),
  categoryIds: z.array(z.string().trim()).default([]),
  tags: z.array(z.string().trim()).default([]),
  status: blogPostStatusSchema.default("draft"),
  coverImage: z
    .string()
    .trim()
    .max(500, "Image URL too long")
    .optional()
    .or(z.literal("")),
});

export type CreateBlogPostInput = z.infer<typeof createBlogPostSchema>;

export const updateBlogPostSchema = createBlogPostSchema.partial().extend({
  id: z.string().trim().min(1, "Post ID is required"),
});

export type UpdateBlogPostInput = z.infer<typeof updateBlogPostSchema>;

export const createForumTopicSchema = z.object({
  title: z
    .string()
    .trim()
    .min(4, "Title must be at least 4 characters")
    .max(150, "Title must be under 150 characters"),
  body: z
    .string()
    .trim()
    .min(10, "Discussion body must be at least 10 characters")
    .max(20000, "Body must be under 20,000 characters"),
  categoryId: z.string().trim().optional().or(z.literal("")),
  isPinned: z.boolean().default(false),
});

export type CreateForumTopicInput = z.infer<typeof createForumTopicSchema>;

export const createForumReplySchema = z.object({
  topicId: z.string().trim().min(1, "Topic ID is required"),
  parentReplyId: z.string().trim().nullish(),
  body: z
    .string()
    .trim()
    .min(2, "Reply cannot be empty")
    .max(10000, "Reply must be under 10,000 characters"),
});

export type CreateForumReplyInput = z.infer<typeof createForumReplySchema>;

export const commentTargetTypeSchema = z.enum(["blog_post", "forum_topic"]);

export const createCommentSchema = z.object({
  targetType: commentTargetTypeSchema,
  targetId: z.string().trim().min(1, "Target ID is required"),
  body: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty")
    .max(2000, "Comment cannot exceed 2,000 characters"),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const startChatSchema = z.object({
  visitorName: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name too long"),
  visitorEmail: z
    .string()
    .trim()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")),
  initialMessage: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(2000, "Message cannot exceed 2,000 characters"),
  channel: z.enum(["web_widget", "internal_support"]).default("web_widget"),
});

export type StartChatInput = z.infer<typeof startChatSchema>;

export const sendChatMessageSchema = z.object({
  conversationId: z.string().trim().min(1, "Conversation ID is required"),
  body: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(4000, "Message cannot exceed 4,000 characters"),
  // The sender's role and the message type are decided by the server (who started the conversation, who may answer it).
  // Clients can neither choose them nor post as the bot or the system, so they are not part of the input.
});

export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const generateAiSummarySchema = z.object({
  blogPostId: z.string().trim().min(1, "Blog post ID is required"),
});

export type GenerateAiSummaryInput = z.infer<typeof generateAiSummarySchema>;

export const generateAiChatReplySchema = z.object({
  conversationId: z.string().trim().min(1, "Conversation ID is required"),
  lastMessage: z.string().trim().optional(),
});

export type GenerateAiChatReplyInput = z.infer<typeof generateAiChatReplySchema>;
