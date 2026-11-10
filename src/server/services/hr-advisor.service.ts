import "server-only";

import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import type { AiChatOptions, AiChatResult } from "@/server/ai";
import clientPromise from "@/server/db/client";
import { ensureIndexes } from "@/server/db/indexes";
import { HR_AI_COLLECTIONS } from "@/server/services/hr-ai.indexes";
import { logAiEvent, type AiActor } from "@/server/services/hr-ai.service";
import { getEmployeeById, getEmployees, getPublicHolidays, getSoldeDeConge } from "@/server/services/hr.service";
import { formatDateYMD } from "@/features/hr/utils/date-utils";
import {
  ADVISOR_SYSTEM_PROMPT,
  evaluateHardRules,
  factsForModel,
  parseModelRecommendation,
  templateRecommendation,
} from "@/features/hr/ai/advisor-rules";
import { detectPromptInjection } from "@/features/hr/ai/guardrails";
import { compressPolicyText } from "@/features/hr/ai/context-compression";
import { searchPolicies } from "@/features/hr/ai/policy-search";
import type { AdvisorCardData, AdvisorRecommendation, RequestFacts } from "@/features/hr/ai/types";

const ATTENDANCE_WINDOW_DAYS = 60;
/** Latest on-time arrival, from the attendance policy's flexible window. */
const LATE_AFTER_MINUTES = 9 * 60 + 30;
const BUSINESS_TIME_ZONE = "Africa/Tunis";
const MODEL_ATTEMPTS = 2;
const MODEL_MAX_TOKENS = 400;

const LEAVE_TYPE_CODES: Record<string, string> = {
  annual: "CP",
  sick: "SICK",
  unpaid: "UNPAID",
  maternity_paternity: "EXCEPTIONAL",
  bereavement: "EXCEPTIONAL",
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function minutesInBusinessZone(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

/**
 * Collects everything known about a leave request, with no LLM involved.
 * Returns null when the request does not exist in this company.
 */
export async function gatherRequestFacts(requestId: string, companyId: string): Promise<RequestFacts | null> {
  if (!ObjectId.isValid(requestId) || !ObjectId.isValid(companyId)) return null;
  const client = await clientPromise;
  const db = client.db();
  const cId = new ObjectId(companyId);

  const doc = await db.collection("leave_requests").findOne({ _id: new ObjectId(requestId), companyId: cId });
  if (!doc) return null;

  const employeeId = doc.employeeId as string;
  const startDate = doc.startDate as string;
  const endDate = doc.endDate as string;
  const departmentName = (doc.departmentName as string) || "General";
  const leaveType = doc.leaveType as string;
  const workingDays = Number(doc.days) || 0;
  const isPaid = Boolean(doc.isPaid);
  const today = formatDateYMD(new Date());
  const yearAgo = addDays(today, -365);
  const windowStart = addDays(today, -ATTENDANCE_WINDOW_DAYS);

  const [employee, solde, holidays, leaveType_, colleagues, teamLeave, ownRequests, attendance] = await Promise.all([
    getEmployeeById(employeeId, companyId),
    getSoldeDeConge(employeeId, new Date(startDate).getFullYear(), companyId),
    getPublicHolidays(companyId),
    db.collection("leave_types").findOne(
      doc.leaveTypeId && ObjectId.isValid(doc.leaveTypeId as string)
        ? { _id: new ObjectId(doc.leaveTypeId as string), companyId: cId }
        : { companyId: cId, code: LEAVE_TYPE_CODES[leaveType] ?? "__none__" },
      { projection: { requiresDocument: 1 } }
    ),
    getEmployees({ status: "active" }, companyId),
    db
      .collection("leave_requests")
      .find(
        {
          companyId: cId,
          departmentName,
          employeeId: { $ne: employeeId },
          status: { $in: ["approved", "taken"] },
          startDate: { $lte: endDate },
          endDate: { $gte: startDate },
        },
        { projection: { employeeId: 1, employeeName: 1 } }
      )
      .toArray(),
    db
      .collection("leave_requests")
      .find({ companyId: cId, employeeId }, { projection: { status: 1, startDate: 1, endDate: 1, createdAt: 1 } })
      .toArray(),
    db
      .collection("attendance")
      .find({ companyId: cId, employeeId, date: { $gte: windowStart, $lt: today } }, { projection: { date: 1, checkIn: 1 } })
      .toArray(),
  ]);

  const others = ownRequests.filter((r) => r._id.toString() !== requestId);
  const holidayDates = new Set(holidays.map((h) => h.date));

  // Attendance: working days in the window with neither a check-in nor approved leave.
  let unexplainedAbsences: number | null = null;
  let lateCheckIns: number | null = null;
  if (attendance.length > 0) {
    const present = new Set(attendance.map((a) => a.date as string));
    const onLeave = others.filter((r) => r.status === "approved" || r.status === "taken");
    // Counted from the first recorded check-in: days before attendance tracking began are unknown, not absences.
    const firstRecord = [...present].sort()[0];
    unexplainedAbsences = 0;
    for (let day = firstRecord; day < today; day = addDays(day, 1)) {
      const expected = isWeekday(day) && !holidayDates.has(day) && !present.has(day);
      if (expected && !onLeave.some((r) => (r.startDate as string) <= day && (r.endDate as string) >= day)) {
        unexplainedAbsences += 1;
      }
    }
    lateCheckIns = attendance.filter(
      (a) => a.checkIn instanceof Date && minutesInBusinessZone(a.checkIn) > LATE_AFTER_MINUTES
    ).length;
  }

  const colleagueCount = colleagues.filter((e) => e.id !== employeeId && e.departmentName === departmentName).length;
  const onLeaveNames = [...new Set(teamLeave.map((r) => (r.employeeName as string) || "Staff"))];
  const reason = (doc.reason as string) || "";
  const recentRequests = others.filter((r) => (r.startDate as string) >= yearAgo);

  return {
    requestId,
    employee: {
      name: (doc.employeeName as string) || employee?.fullName || "Staff",
      department: departmentName,
      hireDate: employee?.hireDate ?? "",
      policyName: solde.policySummary?.name ?? null,
    },
    request: {
      type: leaveType,
      isPaid,
      startDate,
      endDate,
      workingDays,
      reason,
      hasDocument: Boolean(doc.supportingDocumentUrl),
      requiresDocument: Boolean(leaveType_?.requiresDocument),
    },
    balance: isPaid
      ? {
          available: solde.available,
          reserved: solde.reserved,
          after: Math.round((solde.available - workingDays) * 100) / 100,
          overdraftDays: Math.max(0, Math.round((workingDays - solde.available) * 100) / 100),
        }
      : null,
    team: {
      colleagues: colleagueCount,
      onLeaveCount: onLeaveNames.length,
      onLeavePct: colleagueCount > 0 ? Math.round((onLeaveNames.length / colleagueCount) * 100) : 0,
      onLeaveNames,
    },
    attendance: { windowDays: ATTENDANCE_WINDOW_DAYS, unexplainedAbsences, lateCheckIns },
    history: {
      requestsLast12Months: recentRequests.length,
      rejectionsLast12Months: recentRequests.filter((r) => r.status === "rejected").length,
    },
    calendar: {
      holidaysInRange: holidays.filter((h) => h.date >= startDate && h.date <= endDate).map((h) => h.name),
    },
    ownOverlaps: others
      .filter(
        (r) =>
          ["approved", "taken", "pending"].includes(r.status as string) &&
          (r.startDate as string) <= endDate &&
          (r.endDate as string) >= startDate
      )
      .map((r) => ({ status: r.status as string, startDate: r.startDate as string, endDate: r.endDate as string })),
    policy: searchPolicies(`${leaveType} leave ${isPaid ? "paid annual balance overdraft" : "unpaid deduction"}`, 2).map((hit) => ({
      source: hit.source,
      section: hit.section,
      snippet: compressPolicyText(hit.text),
    })),
    reasonFlagged: detectPromptInjection(reason),
  };
}

function toCard(
  recommendation: AdvisorRecommendation,
  facts: RequestFacts,
  meta: { blocked: boolean; origin: AdvisorCardData["origin"]; provider?: string; model?: string; generatedAt: Date }
): AdvisorCardData {
  return {
    ...recommendation,
    blocked: meta.blocked,
    origin: meta.origin,
    provider: meta.provider,
    model: meta.model,
    generatedAt: meta.generatedAt.toISOString(),
    facts: {
      balance: facts.balance,
      team: facts.team,
      attendance: facts.attendance,
      history: facts.history,
      workingDays: facts.request.workingDays,
    },
  };
}

async function askModel(facts: RequestFacts, chat: (options: AiChatOptions) => Promise<AiChatResult>) {
  const content = JSON.stringify(factsForModel(facts));
  for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt++) {
    const result = await chat({
      taskType: "advisor_json",
      jsonObject: true,
      temperature: 0.1,
      maxTokens: MODEL_MAX_TOKENS,
      economy: true,
      messages: [
        { role: "system", content: ADVISOR_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });
    const recommendation = parseModelRecommendation(result.text, facts);
    if (recommendation) return { recommendation, provider: result.provider, model: result.model };
    console.warn(`[hr-advisor] rejected model output from ${result.provider} (attempt ${attempt})`);
  }
  return null;
}

export type AdvisorOutcome =
  | { status: "ok"; card: AdvisorCardData }
  | { status: "not_found" | "not_pending" };

/**
 * The advisor card for one request. Opening a list of requests costs no tokens: without `refresh` it returns a
 * cached AI analysis if its facts are unchanged, otherwise the rules card. The model runs only when an admin asks.
 * It only ever writes to the recommendation cache. It cannot approve or reject anything.
 */
export async function getLeaveRecommendation(
  requestId: string,
  actor: AiActor,
  /** `chat` is the gated model call. Without it the card is always the rules card: this service cannot reach a provider. */
  options: { refresh?: boolean; chat?: (options: AiChatOptions) => Promise<AiChatResult> } = {}
): Promise<AdvisorOutcome> {
  const facts = await gatherRequestFacts(requestId, actor.companyId);
  if (!facts) return { status: "not_found" };

  const client = await clientPromise;
  const db = client.db();
  await ensureIndexes(db);
  const cId = new ObjectId(actor.companyId);

  const status = await db
    .collection("leave_requests")
    .findOne({ _id: new ObjectId(requestId), companyId: cId }, { projection: { status: 1 } });
  if (status?.status !== "pending") return { status: "not_pending" };

  const factsHash = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  const collection = db.collection(HR_AI_COLLECTIONS.recommendations);
  const blockers = evaluateHardRules(facts);

  if (!options.refresh) {
    const cached = await collection.findOne({ companyId: cId, leaveRequestId: requestId, factsHash });
    if (cached) {
      return {
        status: "ok",
        card: toCard(cached.result as AdvisorRecommendation, facts, {
          blocked: blockers.length > 0,
          origin: cached.origin as AdvisorCardData["origin"],
          provider: cached.provider as string | undefined,
          model: cached.model as string | undefined,
          generatedAt: cached.createdAt as Date,
        }),
      };
    }
  }

  const now = new Date();
  const template = templateRecommendation(facts, blockers);

  // A blocked request is decided by rules, so asking a model would add nothing.
  if (!options.refresh || !options.chat || blockers.length > 0) {
    return { status: "ok", card: toCard(template, facts, { blocked: blockers.length > 0, origin: "rules", generatedAt: now }) };
  }

  const started = Date.now();
  try {
    const answer = await askModel(facts, options.chat);
    await logAiEvent(actor, {
      eventType: "TOOL_CALL",
      toolName: "approval_advisor",
      arguments: { requestId },
      resultStatus: answer ? "ok" : "invalid_output",
      provider: answer?.provider,
      model: answer?.model,
      latencyMs: Date.now() - started,
    });
    if (answer) {
      await saveRecommendation(collection, cId, requestId, {
        result: answer.recommendation,
        origin: "llm",
        provider: answer.provider,
        model: answer.model,
        factsHash,
        factsSnapshot: facts,
        createdAt: now,
      });
      return {
        status: "ok",
        card: toCard(answer.recommendation, facts, { blocked: false, origin: "llm", provider: answer.provider, model: answer.model, generatedAt: now }),
      };
    }
  } catch (err) {
    console.warn("[hr-advisor] all providers failed", err instanceof Error ? err.name : "unknown");
    await logAiEvent(actor, {
      eventType: "TOOL_CALL",
      toolName: "approval_advisor",
      arguments: { requestId },
      resultStatus: "provider_failure",
      latencyMs: Date.now() - started,
    });
  }
  return { status: "ok", card: toCard(template, facts, { blocked: false, origin: "rules", generatedAt: now }) };
}

async function saveRecommendation(
  collection: ReturnType<ReturnType<Awaited<typeof clientPromise>["db"]>["collection"]>,
  companyId: ObjectId,
  leaveRequestId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await collection.updateOne(
    { companyId, leaveRequestId },
    { $set: fields, $setOnInsert: { companyId, leaveRequestId } },
    { upsert: true }
  );
}
