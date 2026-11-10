import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createHarness, parsed, type TestHarness } from "../helpers/workspace";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { WorkspaceRole } from "@/server/security/permissions";
import { sendChatMessageSchema, createBlogPostSchema, createForumTopicSchema, createForumReplySchema, createCommentSchema, startChatSchema } from "@/features/community/schemas/community.schema";
import {
  closeChatConversation,
  createBlogPost,
  createComment,
  createForumReply,
  createForumTopic,
  deleteBlogPost,
  deleteComment,
  getBlogPostByIdOrSlug,
  getBlogPosts,
  getChatConversations,
  getChatMessages,
  getCommunityDashboardStats,
  getForumTopicById,
  getForumTopics,
  postBotMessage,
  saveAISummary,
  seedCommunityDemoData,
  sendChatMessage,
  startChatConversation,
  togglePinTopic,
  updateBlogPost,
} from "@/server/services/community.service";

let h: TestHarness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.cleanup();
});

/** A different person in the same company, with the permissions of the given role. */
const person = (role: WorkspaceRole, other = false): WorkspaceContext => ({ ...(other ? h.otherTenant(role) : h.ctx(role)), userId: new ObjectId() });
const post = (title: string, status: "draft" | "published" = "draft") => parsed(createBlogPostSchema, { title, body: `${title} — body text that is long enough.`, status });
const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const audits = (action: string) => h.db.collection("audit_events").countDocuments({ action });

describe("permission matrix", () => {
  const matrix: [string, WorkspaceRole, (ctx: WorkspaceContext) => Promise<unknown>, boolean][] = [];
  const roles: WorkspaceRole[] = ["owner", "admin", "operator", "viewer"];
  const allowed = {
    readPosts: { owner: true, admin: true, operator: true, viewer: true },
    draftPost: { owner: true, admin: true, operator: true, viewer: false },
    publishedPost: { owner: true, admin: true, operator: false, viewer: false },
    topic: { owner: true, admin: true, operator: true, viewer: false },
    pinnedTopic: { owner: true, admin: true, operator: false, viewer: false },
    comment: { owner: true, admin: true, operator: true, viewer: false },
    seed: { owner: true, admin: true, operator: false, viewer: false },
  } as const;
  for (const role of roles) {
    matrix.push(["read posts", role, (c) => getBlogPosts(c), allowed.readPosts[role]]);
    matrix.push(["create a draft article", role, (c) => createBlogPost(c, post("Matrix draft"), "Tester"), allowed.draftPost[role]]);
    matrix.push(["create a published article", role, (c) => createBlogPost(c, post("Matrix published", "published"), "Tester"), allowed.publishedPost[role]]);
    matrix.push(["start a topic", role, (c) => createForumTopic(c, parsed(createForumTopicSchema, { title: "Matrix topic", body: "A topic body long enough." }), "Tester"), allowed.topic[role]]);
    matrix.push(["start a pinned topic", role, (c) => createForumTopic(c, parsed(createForumTopicSchema, { title: "Pinned topic", body: "A topic body long enough.", isPinned: true }), "Tester"), allowed.pinnedTopic[role]]);
  }
  for (const [what, role, run, ok] of matrix) {
    it(`${role} ${ok ? "can" : "cannot"} ${what}`, async () => {
      const outcome = await codeOf(run(person(role)));
      expect(outcome === "ok").toBe(ok);
      if (!ok) expect(outcome).toBe("FORBIDDEN");
    });
  }

  for (const role of roles) {
    it(`${role} ${allowed.comment[role] ? "can" : "cannot"} comment, and ${allowed.seed[role] ? "can" : "cannot"} seed demo data`, async () => {
      const author = h.ctx("owner");
      const created = await createBlogPost(author, post(`Comment target ${role}`), "Owner");
      const outcome = await codeOf(createComment(person(role), parsed(createCommentSchema, { targetType: "blog_post", targetId: created.id, body: "Nice" }), "Tester"));
      expect(outcome === "ok").toBe(allowed.comment[role]);
      // Seeding uses its own company so these runs never collide.
      const seedCtx = { ...person(role), companyId: new ObjectId() };
      const seeded = await codeOf(seedCommunityDemoData(seedCtx));
      expect(seeded === "ok").toBe(allowed.seed[role]);
    });
  }

  it("a revoked permission is refused at the next call (the service rechecks the live context every time)", async () => {
    const ctx = person("operator");
    await createBlogPost(ctx, post("Before revocation"), "Tester");
    const revoked: WorkspaceContext = { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => p !== "community.write")) };
    expect(await codeOf(createBlogPost(revoked, post("After revocation"), "Tester"))).toBe("FORBIDDEN");
  });
});

describe("publishing, drafts and who may see them", () => {
  it("operators edit drafts but cannot publish, archive or edit published articles; administrators can", async () => {
    const operator = person("operator");
    const admin = person("admin");
    const draft = await createBlogPost(operator, post("Operator draft"), "Operator");
    expect(draft.status).toBe("draft");

    const edited = await updateBlogPost(operator, { id: draft.id, title: "Operator draft v2" });
    expect(edited?.title).toBe("Operator draft v2");
    expect(await codeOf(updateBlogPost(operator, { id: draft.id, status: "published" }))).toBe("FORBIDDEN");
    expect(await codeOf(updateBlogPost(operator, { id: draft.id, status: "archived" }))).toBe("FORBIDDEN");

    const published = await updateBlogPost(admin, { id: draft.id, status: "published" });
    expect(published?.status).toBe("published");
    expect(published?.publishedAt).toBeTruthy();
    expect(await codeOf(updateBlogPost(operator, { id: draft.id, title: "Sneaky edit" }))).toBe("FORBIDDEN");
    expect((await updateBlogPost(admin, { id: draft.id, title: "Admin edit" }))?.title).toBe("Admin edit");
  });

  it("read-only members see published articles only, in lists and by id", async () => {
    const owner = h.ctx("owner");
    const draft = await createBlogPost(owner, post("Secret draft"), "Owner");
    const live = await createBlogPost(owner, post("Public article", "published"), "Owner");
    const viewer = person("viewer");

    const visible = (await getBlogPosts(viewer)).map((p) => p.id);
    expect(visible).toContain(live.id);
    expect(visible).not.toContain(draft.id);
    expect(await getBlogPostByIdOrSlug(viewer, draft.id)).toBeNull();
    expect((await getBlogPostByIdOrSlug(viewer, live.id))?.id).toBe(live.id);
    // The viewer cannot ask for drafts through the status filter either.
    expect((await getBlogPosts(viewer, { status: "draft" })).map((p) => p.id)).not.toContain(draft.id);
    expect((await getBlogPosts(owner, { status: "draft" })).map((p) => p.id)).toContain(draft.id);
  });

  it("reading for the assistant does not count a view; reading for a person does", async () => {
    const owner = h.ctx("owner");
    const a = await createBlogPost(owner, post("Views article", "published"), "Owner");
    await getBlogPostByIdOrSlug(owner, a.id, { countView: false });
    await new Promise((r) => setTimeout(r, 50));
    expect((await getBlogPosts(owner)).find((p) => p.id === a.id)?.viewsCount).toBe(0);
    await getBlogPostByIdOrSlug(owner, a.id);
    await new Promise((r) => setTimeout(r, 100));
    expect((await getBlogPosts(owner)).find((p) => p.id === a.id)?.viewsCount).toBe(1);
  });

  it("an edit based on a stale read is rejected, and two writers cannot both win", async () => {
    const admin = person("admin");
    const a = await createBlogPost(admin, post("Versioned"), "Admin");
    await updateBlogPost(admin, { id: a.id, title: "Versioned B" });
    expect(await codeOf(updateBlogPost(admin, { id: a.id, title: "Versioned C" }, { expectedUpdatedAt: a.updatedAt }))).toBe("CONFLICT");

    const fresh = (await getBlogPostByIdOrSlug(admin, a.id, { countView: false }))!;
    const results = await Promise.all([
      codeOf(updateBlogPost(admin, { id: a.id, title: "Winner 1" }, { expectedUpdatedAt: fresh.updatedAt })),
      codeOf(updateBlogPost(admin, { id: a.id, title: "Winner 2" }, { expectedUpdatedAt: fresh.updatedAt })),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
  });

  it("publishing and deleting are audited", async () => {
    const admin = person("admin");
    const before = { published: await audits("community.post.published"), deleted: await audits("community.post.deleted") };
    const a = await createBlogPost(admin, post("Audited"), "Admin");
    await updateBlogPost(admin, { id: a.id, status: "published" });
    await deleteBlogPost(admin, a.id);
    expect(await audits("community.post.published")).toBe(before.published + 1);
    expect(await audits("community.post.deleted")).toBe(before.deleted + 1);
  });
});

describe("deletion", () => {
  it("removes the article, its comments and its summaries together, only for administrators", async () => {
    const admin = person("admin");
    const operator = person("operator");
    const a = await createBlogPost(admin, post("To delete", "published"), "Admin");
    await createComment(operator, parsed(createCommentSchema, { targetType: "blog_post", targetId: a.id, body: "Bye" }), "Op");
    await saveAISummary(operator, { blogPostId: a.id, summary: "s", bulletPoints: ["1", "2", "3"], modelVersion: "test" });

    expect(await codeOf(deleteBlogPost(operator, a.id))).toBe("FORBIDDEN");
    expect(await h.db.collection("comments").countDocuments({ targetId: a.id })).toBe(1);

    expect(await deleteBlogPost(admin, a.id)).toBe(true);
    expect(await h.db.collection("blog_posts").countDocuments({ _id: new ObjectId(a.id) })).toBe(0);
    expect(await h.db.collection("comments").countDocuments({ targetId: a.id })).toBe(0);
    expect(await h.db.collection("ai_summaries").countDocuments({ blogPostId: a.id })).toBe(0);
  });

  it("deleting twice at once succeeds exactly once", async () => {
    const admin = person("admin");
    const a = await createBlogPost(admin, post("Race delete"), "Admin");
    const results = await Promise.all([deleteBlogPost(admin, a.id), deleteBlogPost(admin, a.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("members delete only their own comments; administrators moderate any", async () => {
    const owner = h.ctx("owner");
    const target = await createBlogPost(owner, post("Comments", "published"), "Owner");
    const alice = person("operator");
    const bob = person("operator");
    const viewer = person("viewer");
    const mk = (ctx: WorkspaceContext) => createComment(ctx, parsed(createCommentSchema, { targetType: "blog_post", targetId: target.id, body: "hello" }), "x");
    const aliceComment = await mk(alice);
    expect(await deleteComment(bob, aliceComment.id)).toBe(false);
    expect(await codeOf(deleteComment(viewer, aliceComment.id))).toBe("FORBIDDEN");
    expect(await deleteComment(alice, aliceComment.id)).toBe(true);
    const another = await mk(alice);
    expect(await deleteComment(person("admin"), another.id)).toBe(true);
  });
});

describe("forum", () => {
  it("pinning is atomic and administrator-only", async () => {
    const owner = h.ctx("owner");
    const operator = person("operator");
    const topic = await createForumTopic(operator, parsed(createForumTopicSchema, { title: "Pin me", body: "A topic body long enough." }), "Op");
    expect(await codeOf(togglePinTopic(operator, topic.id))).toBe("FORBIDDEN");
    expect(await togglePinTopic(owner, topic.id)).toBe(true);
    await Promise.all([togglePinTopic(owner, topic.id), togglePinTopic(owner, topic.id)]); // two flips cancel out
    expect((await getForumTopicById(owner, topic.id))?.isPinned).toBe(true);
  });

  it("replies and comments must point at something that exists in this company", async () => {
    const owner = h.ctx("owner");
    const foreign = await createForumTopic(h.otherTenant("owner"), parsed(createForumTopicSchema, { title: "Foreign topic", body: "A topic body long enough." }), "Other");
    const missing = new ObjectId().toHexString();
    expect(await codeOf(createForumReply(owner, parsed(createForumReplySchema, { topicId: foreign.id, body: "hi there" }), "Me"))).toBe("NOT_FOUND");
    expect(await codeOf(createForumReply(owner, parsed(createForumReplySchema, { topicId: missing, body: "hi there" }), "Me"))).toBe("NOT_FOUND");
    expect(await codeOf(createComment(owner, parsed(createCommentSchema, { targetType: "forum_topic", targetId: foreign.id, body: "hi" }), "Me"))).toBe("NOT_FOUND");
    expect(await codeOf(createForumTopic(owner, parsed(createForumTopicSchema, { title: "Bad category", body: "A topic body long enough.", categoryId: new ObjectId().toHexString() }), "Me"))).toBe("VALIDATION_ERROR");
  });
});

describe("two-company isolation", () => {
  it("another company can neither read, edit, delete, summarise nor pin anything", async () => {
    const owner = h.ctx("owner");
    const a = await createBlogPost(owner, post("Company A article", "published"), "Owner");
    const topic = await createForumTopic(owner, parsed(createForumTopicSchema, { title: "Company A topic", body: "A topic body long enough." }), "Owner");
    const intruder = person("owner", true);

    expect((await getBlogPosts(intruder)).map((p) => p.id)).not.toContain(a.id);
    expect(await getBlogPostByIdOrSlug(intruder, a.id)).toBeNull();
    expect(await updateBlogPost(intruder, { id: a.id, title: "Hijacked" })).toBeNull();
    expect(await deleteBlogPost(intruder, a.id)).toBe(false);
    expect(await codeOf(saveAISummary(intruder, { blogPostId: a.id, summary: "s", bulletPoints: [], modelVersion: "x" }))).toBe("NOT_FOUND");
    expect(await togglePinTopic(intruder, topic.id)).toBe(false);
    expect((await getForumTopics(intruder)).map((t) => t.id)).not.toContain(topic.id);
    expect((await getBlogPostByIdOrSlug(owner, a.id, { countView: false }))?.title).toBe("Company A article");
  });
});

describe("live chat: no impersonation", () => {
  const start = (ctx: WorkspaceContext, name = "Visitor", message = "I need help with my invoice") => startChatConversation(ctx, parsed(startChatSchema, { visitorName: name, visitorEmail: "visitor@example.test", initialMessage: message }));

  it("the person who starts a conversation writes as the visitor; a support agent writes as an agent", async () => {
    const viewer = person("viewer");
    const agent = person("operator");
    const { conversation } = await start(viewer);
    const visitorMsg = await sendChatMessage(viewer, parsed(sendChatMessageSchema, { conversationId: conversation.id, body: "Any news?" }), "Vera");
    expect(visitorMsg.senderType).toBe("visitor");
    const agentMsg = await sendChatMessage(agent, parsed(sendChatMessageSchema, { conversationId: conversation.id, body: "On it." }), "Agent");
    expect(agentMsg.senderType).toBe("agent");
    expect((await getChatMessages(viewer, conversation.id)).map((m) => m.senderType)).toEqual(["visitor", "visitor", "agent"]);
  });

  it("a client cannot choose the sender type: forged bot or system fields never reach the service", async () => {
    const viewer = person("viewer");
    const { conversation } = await start(viewer);
    const forged = parsed(sendChatMessageSchema, { conversationId: conversation.id, body: "I am the bot", senderType: "bot", messageType: "faq_answer" });
    expect(Object.keys(forged).sort()).toEqual(["body", "conversationId"]);
    const stored = await sendChatMessage(viewer, forged, "Mallory");
    expect(stored.senderType).toBe("visitor");
    expect(stored.messageType).toBe("text");
  });

  it("someone who did not start the conversation and is not an agent cannot read it, answer it or hear the bot", async () => {
    const owner = person("viewer");
    const stranger = person("viewer");
    const { conversation } = await start(owner);
    expect(await codeOf(getChatMessages(stranger, conversation.id))).toBe("NOT_FOUND");
    expect(await codeOf(sendChatMessage(stranger, parsed(sendChatMessageSchema, { conversationId: conversation.id, body: "hi" }), "S"))).toBe("NOT_FOUND");
    expect(await codeOf(postBotMessage(stranger, conversation.id, "bot says hi"))).toBe("NOT_FOUND");
    expect((await getChatConversations(stranger)).map((c) => c.id)).not.toContain(conversation.id);
    expect((await getChatConversations(owner)).map((c) => c.id)).toContain(conversation.id);
    expect((await getChatConversations(person("operator"))).map((c) => c.id)).toContain(conversation.id);
  });

  it("the bot reply is stored by the server as the bot's, and an unrelated company cannot reach the conversation", async () => {
    const viewer = person("viewer");
    const { conversation } = await start(viewer);
    const bot = await postBotMessage(viewer, conversation.id, "Automated FAQ answer");
    expect(bot).toMatchObject({ senderType: "bot", messageType: "faq_answer", senderName: "AnOps Support Bot" });
    const foreignAgent = person("owner", true);
    expect(await codeOf(getChatMessages(foreignAgent, conversation.id))).toBe("NOT_FOUND");
    expect(await codeOf(sendChatMessage(foreignAgent, parsed(sendChatMessageSchema, { conversationId: conversation.id, body: "hello" }), "F"))).toBe("NOT_FOUND");
    expect(await codeOf(closeChatConversation(foreignAgent, conversation.id))).toBe("ok"); // refused as "not found": returns false, no change
    expect((await getChatConversations(person("operator"))).find((c) => c.id === conversation.id)?.status).toBe("open");
  });

  it("closing needs the support permission, happens once, and ends the conversation", async () => {
    const viewer = person("viewer");
    const agent = person("operator");
    const { conversation } = await start(viewer);
    expect(await codeOf(closeChatConversation(viewer, conversation.id))).toBe("FORBIDDEN");
    const results = await Promise.all([closeChatConversation(agent, conversation.id), closeChatConversation(agent, conversation.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await codeOf(sendChatMessage(agent, parsed(sendChatMessageSchema, { conversationId: conversation.id, body: "late" }), "A"))).toBe("INVALID_TRANSITION");
    expect(await audits("community.chat.closed")).toBeGreaterThanOrEqual(1);
  });
});

describe("dashboard counts follow visibility", () => {
  it("read-only members count published articles only and their own chats; operators count drafts; support agents count every chat", async () => {
    const owner = h.ctx("owner");
    const company = { companyId: new ObjectId() };
    const as = (role: WorkspaceRole): WorkspaceContext => ({ ...person(role), ...company });
    await createBlogPost({ ...owner, ...company }, post("Counted draft"), "Owner");
    await createBlogPost({ ...owner, ...company }, post("Counted live", "published"), "Owner");
    const visitor = as("viewer");
    await startChatConversation(visitor, parsed(startChatSchema, { visitorName: "Own chat", initialMessage: "hello" }));
    await startChatConversation(as("viewer"), parsed(startChatSchema, { visitorName: "Someone else", initialMessage: "hello" }));
    const viewerStats = await getCommunityDashboardStats(visitor);
    expect([viewerStats.totalBlogPosts, viewerStats.draftBlogPosts, viewerStats.openChatConversations]).toEqual([1, 0, 1]);
    const operatorStats = await getCommunityDashboardStats(as("operator"));
    expect([operatorStats.totalBlogPosts, operatorStats.draftBlogPosts, operatorStats.openChatConversations]).toEqual([2, 1, 2]);
  });
});

describe("demo data is never automatic", () => {
  it("reading Community creates nothing, and the page no longer seeds on render", async () => {
    const lonely = { ...h.ctx("owner"), companyId: new ObjectId() };
    expect(await getBlogPosts(lonely)).toEqual([]);
    expect(await h.db.collection("content_categories").countDocuments({ companyId: lonely.companyId })).toBe(0);
    const page = readFileSync("src/app/(dashboard)/community/page.tsx", "utf8");
    expect(page).not.toMatch(/seedCommunity/);
  });

  it("an administrator can add demo data once, even when two requests arrive together", async () => {
    const admin = { ...h.ctx("admin"), companyId: new ObjectId() };
    const results = await Promise.all([seedCommunityDemoData(admin), seedCommunityDemoData(admin)]);
    expect(results.filter((r) => r.seeded)).toHaveLength(1);
    expect(await h.db.collection("content_categories").countDocuments({ companyId: admin.companyId })).toBeGreaterThan(0);
    expect(await h.db.collection("blog_posts").countDocuments({ companyId: admin.companyId })).toBe(1);
    expect((await seedCommunityDemoData(admin)).seeded).toBe(false);
  });
});
