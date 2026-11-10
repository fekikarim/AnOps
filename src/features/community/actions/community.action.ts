"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentAuthUser } from "@/server/auth/rbac";
import { resolveWorkspace, type WorkspaceContext } from "@/server/tenancy/workspace";
import { toActionError } from "@/server/actions/run-action";
import { parseWithSchema } from "@/shared/lib/validation";
import {
  createBlogPostSchema,
  updateBlogPostSchema,
  createForumTopicSchema,
  createForumReplySchema,
  createCommentSchema,
  startChatSchema,
  sendChatMessageSchema,
  generateAiSummarySchema,
} from "@/features/community/schemas/community.schema";
import {
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  getBlogPostByIdOrSlug,
  createForumTopic,
  togglePinTopic,
  createForumReply,
  createComment,
  deleteComment,
  startChatConversation,
  sendChatMessage,
  postBotMessage,
  closeChatConversation,
  getChatConversationById,
  getChatMessages,
  saveAISummary,
  saveAIReplySuggestion,
  getBlogPosts,
  seedCommunityDemoData,
} from "@/server/services/community.service";
import {
  summarizeBlogArticle,
  CommunitySupportAgent,
  generateSupportReplySuggestions,
} from "@/features/community/ai/community-ai.agent";
import type { AgentMessage } from "@/server/ai/base-agent";
import { gatedComplete } from "@/server/ai/gate";
import type { AiCompletionOptions } from "@/server/ai/types";

export type ActionResult<T = unknown> =
  | { success: true; data: T; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Every Community action resolves the workspace first (live account check, active company, role permissions) and the
 * service enforces the permission it needs. A hidden button is never the only control. Messages for expected errors
 * (forbidden, not found, stale) are shown as they are; anything unexpected becomes a generic message.
 */
async function act<T = unknown>(name: string, operation: (ctx: WorkspaceContext, person: string) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const requestId = randomUUID();
  try {
    const ctx = await resolveWorkspace(requestId);
    const authUser = await getCurrentAuthUser("community");
    const person = authUser?.employee?.fullName || authUser?.email || "Member";
    return await operation(ctx, person);
  } catch (error) {
    return { success: false, error: toActionError(error, requestId, `community.${name}`).message };
  }
}

/** The only way Community reaches a model: through the shared AI gate, as the feature the person is using. */
const gated = (ctx: WorkspaceContext, operation: "view" | "create", feature: string) => (options: AiCompletionOptions) =>
  gatedComplete(ctx, { module: "community", operation, feature }, options);

const invalid = (parsed: { message: string; errors?: Record<string, string> }): { success: false; error: string; fieldErrors?: Record<string, string> } => ({ success: false, error: parsed.message, fieldErrors: parsed.errors });

// ============================================================================
// BLOG POST ACTIONS
// ============================================================================

export async function createBlogPostAction(rawInput: unknown): Promise<ActionResult> {
  return act("createPost", async (ctx, person) => {
    const parsed = parseWithSchema(createBlogPostSchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const post = await createBlogPost(ctx, parsed.data, person);
    revalidatePath("/community");
    return { success: true, data: post, message: "Article created successfully" };
  });
}

export async function updateBlogPostAction(rawInput: unknown): Promise<ActionResult> {
  return act("updatePost", async (ctx) => {
    const parsed = parseWithSchema(updateBlogPostSchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const post = await updateBlogPost(ctx, parsed.data);
    if (!post) return { success: false, error: "Article not found" };
    revalidatePath("/community");
    return { success: true, data: post, message: "Article updated successfully" };
  });
}

export async function publishBlogPostAction(postId: string): Promise<ActionResult> {
  return act("publishPost", async (ctx) => {
    const post = await updateBlogPost(ctx, { id: postId, status: "published" });
    if (!post) return { success: false, error: "Article not found" };
    revalidatePath("/community");
    return { success: true, data: post, message: "Article published successfully" };
  });
}

export async function deleteBlogPostAction(postId: string): Promise<ActionResult> {
  return act("deletePost", async (ctx) => {
    if (!(await deleteBlogPost(ctx, postId))) return { success: false, error: "Article could not be deleted" };
    revalidatePath("/community");
    return { success: true, data: { id: postId }, message: "Article deleted" };
  });
}

/** Explicit, administrator-only demo content. Nothing calls this automatically. */
export async function seedCommunityDemoDataAction(): Promise<ActionResult> {
  return act("seedDemo", async (ctx) => {
    const result = await seedCommunityDemoData(ctx);
    revalidatePath("/community");
    return { success: true, data: result, message: result.seeded ? "Demo content added" : "Demo content was not added: this company already has categories" };
  });
}

// ============================================================================
// FORUM ACTIONS
// ============================================================================

export async function createForumTopicAction(rawInput: unknown): Promise<ActionResult> {
  return act("createTopic", async (ctx, person) => {
    const parsed = parseWithSchema(createForumTopicSchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const topic = await createForumTopic(ctx, parsed.data, person);
    revalidatePath("/community");
    return { success: true, data: topic, message: "Discussion topic started" };
  });
}

export async function togglePinTopicAction(topicId: string): Promise<ActionResult> {
  return act("pinTopic", async (ctx) => {
    const isPinned = await togglePinTopic(ctx, topicId);
    revalidatePath("/community");
    return { success: true, data: { isPinned }, message: isPinned ? "Topic pinned to top" : "Topic unpinned" };
  });
}

export async function createForumReplyAction(rawInput: unknown): Promise<ActionResult> {
  return act("createReply", async (ctx, person) => {
    const parsed = parseWithSchema(createForumReplySchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const reply = await createForumReply(ctx, parsed.data, person);
    revalidatePath("/community");
    return { success: true, data: reply, message: "Reply posted" };
  });
}

// ============================================================================
// COMMENTS ENGINE ACTIONS
// ============================================================================

export async function createCommentAction(rawInput: unknown): Promise<ActionResult> {
  return act("createComment", async (ctx, person) => {
    const parsed = parseWithSchema(createCommentSchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const comment = await createComment(ctx, parsed.data, person);
    revalidatePath("/community");
    return { success: true, data: comment, message: "Comment posted" };
  });
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  return act("deleteComment", async (ctx) => {
    if (!(await deleteComment(ctx, commentId))) return { success: false, error: "Comment could not be deleted" };
    revalidatePath("/community");
    return { success: true, data: { id: commentId }, message: "Comment deleted" };
  });
}

// ============================================================================
// LIVE SUPPORT CHAT ACTIONS
// ============================================================================

export async function startChatConversationAction(rawInput: unknown): Promise<ActionResult> {
  return act("startChat", async (ctx) => {
    const parsed = parseWithSchema(startChatSchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const result = await startChatConversation(ctx, parsed.data);
    revalidatePath("/community");
    return { success: true, data: result, message: "Support conversation started" };
  });
}

export async function sendChatMessageAction(rawInput: unknown): Promise<ActionResult> {
  return act("sendChat", async (ctx, person) => {
    const parsed = parseWithSchema(sendChatMessageSchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const message = await sendChatMessage(ctx, parsed.data, person);
    revalidatePath("/community");
    return { success: true, data: message };
  });
}

export async function closeChatConversationAction(conversationId: string): Promise<ActionResult> {
  return act("closeChat", async (ctx) => {
    if (!(await closeChatConversation(ctx, conversationId))) return { success: false, error: "Conversation not found or already closed" };
    revalidatePath("/community");
    return { success: true, data: { id: conversationId }, message: "Conversation marked as closed" };
  });
}

/**
 * The visitor widget's fallback bot (a person-triggered feature of the page, not something the AI Command Center can
 * start). It answers only conversations the caller may open, and the message is stored by the server as the bot's.
 */
export async function triggerAiBotReplyAction(conversationId: string): Promise<ActionResult> {
  return act("botReply", async (ctx) => {
    const conversation = await getChatConversationById(ctx, conversationId);
    if (!conversation) return { success: false, error: "Conversation not found" };

    const messages = await getChatMessages(ctx, conversationId);
    const lastUserMessage = [...messages].reverse().find((m) => m.senderType === "visitor")?.body || "Hello, I need assistance.";
    const articles = await getBlogPosts(ctx, { status: "published" });

    const agent = new CommunitySupportAgent();
    const history: AgentMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.senderType === "visitor" ? "user" : "assistant",
      content: m.body,
      timestamp: m.sentAt,
    }));
    const response = await agent.chat(history, lastUserMessage, {
      companyName: "your company",
      visitorName: conversation.visitorName,
      recentArticles: articles.map((a) => ({ title: a.title, excerpt: a.excerpt })),
    }, gated(ctx, "view", "community.bot"));

    const botMsg = await postBotMessage(ctx, conversationId, response.message.content);
    revalidatePath("/community");
    return { success: true, data: botMsg, message: "AI bot reply sent" };
  });
}

/** AI suggestions for a human agent to reply with one click. Support agents only. */
export async function getAiReplySuggestionsAction(conversationId: string): Promise<ActionResult<string[]>> {
  return act("replySuggestions", async (ctx) => {
    const messages = await getChatMessages(ctx, conversationId);
    const lastVisitorMsg = [...messages].reverse().find((m) => m.senderType === "visitor")?.body || "Hello";
    const suggestions = await generateSupportReplySuggestions(gated(ctx, "create", "community.suggestions"), lastVisitorMsg);
    if (suggestions[0]) await saveAIReplySuggestion(ctx, { conversationId, suggestedText: suggestions[0] });
    return { success: true, data: suggestions };
  });
}

// ============================================================================
// AI SUMMARY ACTIONS
// ============================================================================

export async function generateBlogPostSummaryAction(rawInput: unknown): Promise<ActionResult> {
  return act("summarize", async (ctx) => {
    const parsed = parseWithSchema(generateAiSummarySchema, rawInput);
    if (!parsed.success) return invalid(parsed);
    const post = await getBlogPostByIdOrSlug(ctx, parsed.data.blogPostId, { countView: false });
    if (!post) return { success: false, error: "Article not found" };
    const summaryData = await summarizeBlogArticle(gated(ctx, "create", "community.summary"), post.title, post.body);
    const savedSummary = await saveAISummary(ctx, { blogPostId: post.id, summary: summaryData.summary, bulletPoints: summaryData.bulletPoints, modelVersion: summaryData.modelVersion });
    revalidatePath("/community");
    return { success: true, data: savedSummary, message: "3-bullet AI summary generated successfully" };
  });
}
