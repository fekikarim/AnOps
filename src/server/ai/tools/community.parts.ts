import "server-only";
import type { AiAccess } from "@/server/ai/access/access.service";
import { maskVisitorEmail, redactPersonalData, type CommunityScope } from "@/server/ai/community/access";
import type { AiAction, AiBadge, AiRecordCardPart, AiRecordTablePart } from "@/server/db/documents";
import type { AiOperation } from "@/shared/domain/ai";
import type { BlogPost, ChatConversation, ChatMessage, CommunityDashboardStats, ContentCategory, ForumReply, ForumTopic } from "@/features/community/types";

/**
 * Community results as structured parts. Visitor emails are masked and chat text is redacted before it gets here. Actions are
 * offered only to people who may use them, and each one goes back through the command runner, which authorises it again.
 */
const can = (access: AiAccess, op: AiOperation) => access.can("community", op);
type Args = Record<string, string | number | boolean>;
type Paged<T> = { items: T[]; total: number; page: number; totalPages: number };

export const PAGE_SIZE = 10;
/** One database page: the caller counts first, then reads only the rows of the page it shows. */
export async function pageOf<T>(total: number, requested: number | undefined, load: (skip: number, limit: number) => Promise<T[]>): Promise<Paged<T>> {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, requested ?? 1), totalPages);
  return { items: await load((page - 1) * PAGE_SIZE, PAGE_SIZE), total, page, totalPages };
}

const POST_TONE: Record<string, AiBadge["tone"]> = { draft: "warning", published: "success", archived: "neutral" };
const postBadge = (status: string): AiBadge => ({ label: status[0].toUpperCase() + status.slice(1), tone: POST_TONE[status] ?? "neutral" });
const day = (iso: string) => iso.slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function postsTable(page: Paged<BlogPost>, args: Args, select?: { command: string; title: string }): AiRecordTablePart {
  return {
    type: "record_table",
    title: select?.title ?? "Articles",
    columns: [{ key: "title", label: "Article" }, { key: "author", label: "Author" }, { key: "updated", label: "Updated" }],
    rows: page.items.map((p) => ({
      id: p.id,
      cells: { title: p.title, author: p.authorName, updated: day(p.updatedAt) },
      badge: postBadge(p.status),
      actions: [select ? { label: "Select", command: select.command, args: { postId: p.id }, step: "select" as const } : { label: "Open", command: "post", args: { postId: p.id } }],
    })),
    total: page.total,
    emptyMessage: "No articles match. Create one with /newpost.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? select.command : "posts", args },
  };
}

export function postCard(p: BlogPost, scope: CommunityScope, access: AiAccess, categoryNames: string[]): AiRecordCardPart {
  const args = { postId: p.id };
  const actions: AiAction[] = [];
  if (p.status === "draft" && scope.write && can(access, "edit")) actions.push({ label: "Edit", command: "editpost", args, step: "select" });
  if (scope.admin && can(access, "approve")) {
    if (p.status === "draft") actions.push({ label: "Publish", command: "publishpost", args, step: "select" });
    if (p.status === "published") actions.push({ label: "Archive", command: "archivepost", args, step: "select" });
  }
  return {
    type: "record_card",
    title: p.title,
    subtitle: `${p.authorName} · ${p.readingTimeMinutes} min read`,
    badges: [postBadge(p.status)],
    fields: [
      { label: "Updated", value: day(p.updatedAt) },
      ...(p.publishedAt ? [{ label: "Published", value: day(p.publishedAt) }] : []),
      ...(categoryNames.length ? [{ label: "Categories", value: categoryNames.join(", ") }] : []),
      ...(p.tags.length ? [{ label: "Tags", value: p.tags.join(", ") }] : []),
    ],
    sections: [{ title: "Article", rows: [{ label: "Excerpt", value: p.excerpt }, { label: "Text", value: clip(p.body, 900) }] }],
    actions,
  };
}

export function topicsTable(page: Paged<ForumTopic>, args: Args, select?: { command: string; title: string }): AiRecordTablePart {
  return {
    type: "record_table",
    title: select?.title ?? "Forum topics",
    columns: [{ key: "title", label: "Topic" }, { key: "author", label: "Author" }, { key: "replies", label: "Replies", align: "right" }],
    rows: page.items.map((t) => ({
      id: t.id,
      cells: { title: t.title, author: t.authorName, replies: String(t.repliesCount) },
      badge: t.isPinned ? { label: "Pinned", tone: "info" } : undefined,
      actions: [select ? { label: "Select", command: select.command, args: { topicId: t.id }, step: "select" as const } : { label: "Open", command: "topic", args: { topicId: t.id } }],
    })),
    total: page.total,
    emptyMessage: "No topics yet. Start one with /newtopic.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? select.command : "topics", args },
  };
}

export function topicCard(t: ForumTopic, replies: ForumReply[], scope: CommunityScope, access: AiAccess): AiRecordCardPart {
  const args = { topicId: t.id };
  const actions: AiAction[] = [];
  if (scope.write && can(access, "create") && t.status === "open") actions.push({ label: "Reply", command: "replytopic", args, step: "select" });
  if (scope.admin && can(access, "approve")) actions.push({ label: t.isPinned ? "Unpin" : "Pin", command: "pintopic", args, step: "select" });
  return {
    type: "record_card",
    title: t.title,
    subtitle: `${t.authorName}${t.categoryName ? ` · ${t.categoryName}` : ""}`,
    badges: t.isPinned ? [{ label: "Pinned", tone: "info" }] : [],
    fields: [{ label: "Replies", value: String(t.repliesCount) }, { label: "Status", value: t.status }],
    sections: [
      { title: "Question", rows: [{ label: t.authorName, value: clip(t.body, 700) }] },
      ...(replies.length ? [{ title: "Replies", rows: replies.slice(0, 8).map((r) => ({ label: r.authorName, value: clip(r.body, 300) })) }] : []),
    ],
    actions,
  };
}

export function categoriesTable(categories: ContentCategory[], tags: string[]): AiRecordTablePart {
  return {
    type: "record_table",
    title: "Categories and tags",
    columns: [{ key: "name", label: "Category" }, { key: "description", label: "Description" }],
    rows: categories.map((c) => ({ id: c.id, cells: { name: c.name, description: c.description ?? "" } })),
    total: categories.length,
    emptyMessage: tags.length ? `No categories. Tags: ${tags.join(", ")}.` : "No categories or tags yet.",
  };
}

export function conversationsTable(page: Paged<ChatConversation>, args: Args, select?: { command: string; title: string }): AiRecordTablePart {
  return {
    type: "record_table",
    title: select?.title ?? "Support conversations",
    columns: [{ key: "visitor", label: "Visitor" }, { key: "email", label: "Email" }, { key: "last", label: "Last message" }],
    rows: page.items.map((c) => ({
      id: c.id,
      cells: { visitor: c.visitorName, email: maskVisitorEmail(c.visitorEmail) || "None", last: c.lastMessageAt.slice(0, 16).replace("T", " ") },
      badge: c.status === "closed" ? { label: "Closed", tone: "neutral" } : { label: c.unreadCount > 0 ? `${c.unreadCount} unread` : "Open", tone: "warning" },
      actions: [select ? { label: "Select", command: select.command, args: { conversationId: c.id }, step: "select" as const } : { label: "Open", command: "conversation", args: { conversationId: c.id } }],
    })),
    total: page.total,
    emptyMessage: "No conversations.",
    paging: { page: page.page, totalPages: page.totalPages, command: select ? select.command : "conversations", args },
  };
}

export function conversationCard(c: ChatConversation, messages: ChatMessage[], access: AiAccess): AiRecordCardPart {
  const args = { conversationId: c.id };
  const actions: AiAction[] = [];
  if (c.status !== "closed") {
    if (can(access, "create")) actions.push({ label: "Reply", command: "supportreply", args, step: "select" });
    if (can(access, "edit")) actions.push({ label: "Close", command: "closechat", args, step: "select" });
  }
  return {
    type: "record_card",
    title: c.visitorName,
    subtitle: `${maskVisitorEmail(c.visitorEmail) || "No email"} · ${c.channel.replace("_", " ")}`,
    badges: [c.status === "closed" ? { label: "Closed", tone: "neutral" } : { label: "Open", tone: "warning" }],
    fields: [{ label: "Started", value: c.startedAt.slice(0, 16).replace("T", " ") }, { label: "Messages", value: String(messages.length) }],
    sections: [{ title: "Latest messages", rows: messages.slice(-8).map((m) => ({ label: `${m.senderType === "visitor" ? c.visitorName : m.senderName} (${m.senderType})`, value: clip(redactPersonalData(m.body), 400) })) }],
    actions,
  };
}

export function statsCard(s: CommunityDashboardStats): AiRecordCardPart {
  return {
    type: "record_card",
    title: "Community overview",
    subtitle: "Articles, forum and support",
    badges: [],
    fields: [
      { label: "Articles", value: `${s.totalBlogPosts} (${s.publishedBlogPosts} published, ${s.draftBlogPosts} drafts)` },
      { label: "Forum", value: `${s.totalForumTopics} topics, ${s.totalForumReplies} replies` },
      { label: "Comments", value: String(s.totalComments) },
      { label: "Open chats", value: String(s.openChatConversations) },
    ],
    actions: [],
  };
}
