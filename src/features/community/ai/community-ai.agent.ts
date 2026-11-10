import "server-only";

import { askWith, BaseAgent, type AgentComplete } from "@/server/ai/base-agent";
import { isAppError } from "@/shared/lib/errors";
import type { AgentContext } from "@/server/ai/base-agent";

export interface ArticleSummaryResult {
  summary: string;
  bulletPoints: string[];
  modelVersion: string;
}

/**
 * Generates an executive 3-bullet summary of a blog article using AnOps AI Master.
 * Fulfills AnOps.md Module 5 requirement: "Generates quick 3-bullet summaries for blog posts."
 */
export async function summarizeBlogArticle(
  complete: AgentComplete,
  title: string,
  body: string
): Promise<ArticleSummaryResult> {
  const prompt = `You are the AnOps Content Summarizer AI.
Your task is to analyze the following company blog article and generate an executive summary.

Requirements:
1. Provide a concise 1-2 sentence overview paragraph.
2. Provide exactly THREE bullet points highlighting the key takeaways.
3. Keep the tone professional, clear, and business-focused.

Format your response strictly as JSON with this schema:
{
  "summary": "1-2 sentence overview",
  "bulletPoints": [
    "First key takeaway",
    "Second key takeaway",
    "Third key takeaway"
  ]
}

Article Title: ${title}

Article Body:
${body.slice(0, 8000)}
`;

  try {
    const rawResponse = await askWith(
      complete,
      prompt,
      "You are an expert content summarizer. You only output valid JSON conforming to the requested schema."
    );

    // Parse JSON safely
    const cleanJson = rawResponse.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    const bulletPoints: string[] = Array.isArray(parsed.bulletPoints)
      ? parsed.bulletPoints.slice(0, 3).map((bp: unknown) => String(bp).trim())
      : [
          "Overview of operational procedures and best practices.",
          "Strategic considerations for team coordination.",
          "Implementation details and recommended next steps.",
        ];

    return {
      summary: parsed.summary || "Summary of " + title,
      bulletPoints,
      modelVersion: "anops-ai-master-v1",
    };
  } catch (error) {
    // A refusal by the AI gate (no access, switched off, over a limit) is shown to the person, never hidden behind a fallback.
    if (isAppError(error)) throw error;
    // Graceful fallback if AI is offline or returns unparseable output
    console.warn("AI article summarization fell back to extraction:", error);
    const sentences = body
      .replace(/[#*_`]/g, "")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.length > 25);

    const fallbackBullets = sentences.slice(0, 3);
    while (fallbackBullets.length < 3) {
      fallbackBullets.push(`Key insight regarding ${title.toLowerCase()}`);
    }

    return {
      summary: sentences[0] || `Summary of article: ${title}`,
      bulletPoints: fallbackBullets,
      modelVersion: "heuristic-fallback",
    };
  }
}

export type CommunityChatContext = AgentContext & {
  companyName?: string;
  visitorName?: string;
  recentArticles?: Array<{ title: string; excerpt: string }>;
};

const COMMUNITY_BOT_SYSTEM_PROMPT = `
You are AnOps Live Support Assistant, an AI support bot embedded in the AnOps ERP Community and Support Chat.

## Your Role
- Provide instant, warm, and helpful answers to customer and visitor inquiries.
- Act as the automated fallback chatbot when human support operators are unavailable or offline.
- Answer questions regarding AnOps modules (HR, Inventory, Finance, Community, Sales, CRM).
- Direct users to relevant knowledge base sections, blog articles, and community forum threads.

## Rules
1. **Concise & Direct** — Keep answers under 3 paragraphs; use bullets for steps.
2. **Warm & Professional** — Address the visitor politely and professionally.
3. **Escalation** — If an inquiry requires account-specific intervention (e.g., custom database migrations, billing refunds), reassure the visitor that a human support specialist will follow up shortly.
4. **Never fabricate system details** — Stick to established ERP workflows.
`.trim();

/**
 * CommunitySupportAgent — extends BaseAgent for real-time live chat FAQ & automated support.
 */
export class CommunitySupportAgent extends BaseAgent {
  constructor() {
    super({
      name: "AnOps Community Support Bot",
      description: "Automated live chat responder and FAQ assistant.",
      systemPrompt: COMMUNITY_BOT_SYSTEM_PROMPT,
      defaults: {
        temperature: 0.3,
        maxTokens: 500,
      },
    });
  }

  protected override async enrichContext(
    _userMessage: string,
    context?: AgentContext
  ): Promise<string | null> {
    if (!context) return null;
    const ctx = context as CommunityChatContext;

    const parts: string[] = [];
    if (ctx.companyName) {
      parts.push(`Current Company: ${ctx.companyName}`);
    }
    if (ctx.visitorName) {
      parts.push(`Visitor Name: ${ctx.visitorName}`);
    }
    if (ctx.recentArticles && ctx.recentArticles.length > 0) {
      parts.push("Knowledge Base Highlights:");
      for (const art of ctx.recentArticles.slice(0, 3)) {
        parts.push(`- ${art.title}: ${art.excerpt}`);
      }
    }

    return parts.length > 0 ? parts.join("\n") : null;
  }
}

/**
 * Generates quick reply suggestions for human support agents based on the conversation history.
 */
export async function generateSupportReplySuggestions(
  complete: AgentComplete,
  lastVisitorMessage: string
): Promise<string[]> {
  const prompt = `A visitor just asked the following question in live support chat:
"${lastVisitorMessage}"

Generate exactly 3 short, helpful quick-reply options that a human support agent could click to respond immediately.
Output strictly as a JSON array of 3 strings:
["reply option 1", "reply option 2", "reply option 3"]`;

  try {
    const raw = await askWith(
      complete,
      prompt,
      "You are a helpful customer support co-pilot. Output only a valid JSON array of 3 short replies."
    );
    const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return parsed.slice(0, 3).map((r) => String(r).trim());
    }
  } catch (err) {
    if (isAppError(err)) throw err;
    console.warn("AI quick reply suggestions fallback:", err);
  }

  return [
    "Hello! Thank you for reaching out. How can I assist you with this today?",
    "We have documented this in our Knowledge Base. Let me guide you through the steps.",
    "I am checking this with our technical team right now and will update you in a moment.",
  ];
}
