import { describe, expect, it } from "vitest";
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

describe("Community - Blog Post Schemas", () => {
  it("validates and defaults a valid blog post creation payload", () => {
    const valid = {
      title: "How We Optimized ERP Workflows with AI",
      body: "This is a detailed technical article exploring automated pipelines and prompt engineering.",
      categoryIds: ["cat_123"],
      tags: ["AI", "ERP"],
      status: "published",
    };

    const parsed = createBlogPostSchema.parse(valid);
    expect(parsed.title).toBe("How We Optimized ERP Workflows with AI");
    expect(parsed.status).toBe("published");
    expect(parsed.excerpt).toBe("");
    expect(parsed.tags).toEqual(["AI", "ERP"]);
  });

  it("rejects blog post titles that are too short or empty", () => {
    expect(() =>
      createBlogPostSchema.parse({
        title: "Hi",
        body: "Valid body that has enough characters.",
      })
    ).toThrow(/at least 3 characters/);
  });

  it("rejects blog post body that is too short", () => {
    expect(() =>
      createBlogPostSchema.parse({
        title: "Valid Post Title",
        body: "Short",
      })
    ).toThrow(/at least 10 characters/);
  });

  it("validates blog post update payload requiring id", () => {
    expect(() =>
      updateBlogPostSchema.parse({
        title: "New Title",
      })
    ).toThrow();

    expect(() =>
      updateBlogPostSchema.parse({
        id: "  ",
        title: "New Title",
      })
    ).toThrow(/Post ID is required/);

    const validUpdate = updateBlogPostSchema.parse({
      id: "post_123",
      title: "Updated Title",
      status: "archived",
    });
    expect(validUpdate.id).toBe("post_123");
    expect(validUpdate.status).toBe("archived");
  });
});

describe("Community - Forum Schemas", () => {
  it("validates forum topic creation", () => {
    const topic = createForumTopicSchema.parse({
      title: "Best practices for multi-tenant database indexing",
      body: "Let us discuss compound indexes with companyId as the leading partition key.",
      isPinned: true,
    });

    expect(topic.title).toBe("Best practices for multi-tenant database indexing");
    expect(topic.isPinned).toBe(true);
  });

  it("validates forum replies with or without parentReplyId", () => {
    const rootReply = createForumReplySchema.parse({
      topicId: "topic_123",
      body: "Great point! We also recommend sparse indexes for optional fields.",
    });
    expect(rootReply.parentReplyId).toBeUndefined();

    const nestedReply = createForumReplySchema.parse({
      topicId: "topic_123",
      parentReplyId: "reply_root",
      body: "Agreed with that approach.",
    });
    expect(nestedReply.parentReplyId).toBe("reply_root");
  });

  it("rejects empty forum replies", () => {
    expect(() =>
      createForumReplySchema.parse({
        topicId: "topic_123",
        body: " ",
      })
    ).toThrow(/Reply cannot be empty/);
  });
});

describe("Community - Comments Engine Schemas", () => {
  it("accepts valid polymorphic comment for blog_post", () => {
    const comment = createCommentSchema.parse({
      targetType: "blog_post",
      targetId: "post_999",
      body: "Very informative article! Looking forward to the next part.",
    });
    expect(comment.targetType).toBe("blog_post");
    expect(comment.targetId).toBe("post_999");
  });

  it("accepts valid polymorphic comment for forum_topic", () => {
    const comment = createCommentSchema.parse({
      targetType: "forum_topic",
      targetId: "topic_888",
      body: "Thank you for sharing this benchmark.",
    });
    expect(comment.targetType).toBe("forum_topic");
  });

  it("rejects unsupported target types", () => {
    expect(() =>
      createCommentSchema.parse({
        targetType: "product",
        targetId: "prod_1",
        body: "Review",
      })
    ).toThrow();
  });
});

describe("Community - Live Support Chat Schemas", () => {
  it("validates guest chat start with email and initial inquiry", () => {
    const chat = startChatSchema.parse({
      visitorName: "Sarah Connor",
      visitorEmail: "sarah@cyberdyne.io",
      initialMessage: "Can someone help me with the Tunisia VAT invoicing setup?",
    });

    expect(chat.visitorName).toBe("Sarah Connor");
    expect(chat.visitorEmail).toBe("sarah@cyberdyne.io");
    expect(chat.channel).toBe("web_widget");
  });

  it("accepts only the conversation and the text: the sender's role is decided by the server, never by the client", () => {
    const msg = sendChatMessageSchema.parse({
      conversationId: "conv_456",
      body: "Hello Sarah! Yes, in AnOps you can configure the standard 19% VAT in settings.",
      senderType: "bot",
      messageType: "faq_answer",
    });

    expect(msg).toEqual({
      conversationId: "conv_456",
      body: "Hello Sarah! Yes, in AnOps you can configure the standard 19% VAT in settings.",
    });
  });
});

describe("Community - AI Schemas", () => {
  it("validates AI summary request schema", () => {
    const req = generateAiSummarySchema.parse({
      blogPostId: "post_789",
    });
    expect(req.blogPostId).toBe("post_789");
  });
});
