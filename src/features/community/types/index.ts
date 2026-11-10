/**
 * Community / Blogs, Forum & Live Chat Types
 * Standardised to multi-tenant AnOps architecture and UML specifications
 */

export type BlogPostStatus = "draft" | "published" | "archived";

export interface ContentCategory {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
}

export interface ContentTag {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
}

export interface BlogPost {
  id: string;
  companyId: string;
  authorUserId: string;
  authorName: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImage?: string;
  status: BlogPostStatus;
  categoryIds: string[];
  tags: string[];
  readingTimeMinutes: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  viewsCount: number;
  aiSummaryId?: string;
}

export type ForumTopicStatus = "open" | "locked" | "archived";

export interface ForumTopic {
  id: string;
  companyId: string;
  authorUserId: string;
  authorName: string;
  categoryId?: string;
  categoryName?: string;
  title: string;
  body: string;
  status: ForumTopicStatus;
  isPinned: boolean;
  viewsCount: number;
  repliesCount: number;
  lastReplyAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ForumReplyStatus = "active" | "hidden";

export interface ForumReply {
  id: string;
  companyId: string;
  topicId: string;
  authorUserId: string;
  authorName: string;
  parentReplyId?: string | null;
  body: string;
  status: ForumReplyStatus;
  upvotesCount: number;
  createdAt: string;
  updatedAt: string;
}

export type CommentTargetType = "blog_post" | "forum_topic";
export type CommentStatus = "active" | "hidden";

export interface Comment {
  id: string;
  companyId: string;
  authorUserId: string;
  authorName: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
}

export type ChatConversationStatus = "open" | "assigned" | "closed";
export type ChatChannel = "web_widget" | "internal_support";

export interface ChatConversation {
  id: string;
  companyId: string;
  visitorUserId?: string;
  visitorSessionId: string;
  visitorName: string;
  visitorEmail?: string;
  status: ChatConversationStatus;
  channel: ChatChannel;
  assignedToUserId?: string;
  assignedToName?: string;
  startedAt: string;
  closedAt?: string;
  lastMessageAt: string;
  unreadCount: number;
}

export type ParticipantRole = "visitor" | "agent" | "bot";

export interface ConversationParticipant {
  id: string;
  companyId: string;
  conversationId: string;
  userId?: string;
  participantName: string;
  participantRole: ParticipantRole;
  joinedAt: string;
  leftAt?: string;
}

export type SenderType = "visitor" | "agent" | "bot" | "system";
export type MessageType = "text" | "system" | "faq_answer";

export interface ChatMessage {
  id: string;
  companyId: string;
  conversationId: string;
  senderUserId?: string;
  senderType: SenderType;
  senderName: string;
  body: string;
  messageType: MessageType;
  sentAt: string;
  editedAt?: string;
}

export interface AISummary {
  id: string;
  companyId: string;
  blogPostId: string;
  requestedBy: string;
  summary: string;
  bulletPoints: string[];
  status: "pending" | "completed" | "failed";
  modelVersion: string;
  generatedAt: string;
}

export interface AIReplySuggestion {
  id: string;
  companyId: string;
  conversationId: string;
  sourceMessageId?: string;
  suggestedText: string;
  status: "suggested" | "sent" | "discarded";
  reviewedBy?: string;
  generatedAt: string;
}

export interface CommunityDashboardStats {
  totalBlogPosts: number;
  publishedBlogPosts: number;
  draftBlogPosts: number;
  totalForumTopics: number;
  totalForumReplies: number;
  openChatConversations: number;
  totalComments: number;
  aiSummariesGenerated: number;
}
