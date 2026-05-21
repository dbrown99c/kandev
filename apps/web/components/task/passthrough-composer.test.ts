import { describe, it, expect } from "vitest";
import { bucketComments, buildComposerPayload } from "./passthrough-composer";
import type {
  Comment,
  DiffComment,
  PlanComment,
  PRFeedbackComment,
} from "@/lib/state/slices/comments";

function diff(overrides: Partial<DiffComment> = {}): DiffComment {
  return {
    id: "d1",
    sessionId: "s1",
    source: "diff",
    filePath: "src/x.ts",
    startLine: 10,
    endLine: 12,
    side: "additions",
    codeContent: "const x = 1;",
    text: "rename x",
    createdAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

function plan(overrides: Partial<PlanComment> = {}): PlanComment {
  return {
    id: "p1",
    sessionId: "s1",
    source: "plan",
    selectedText: "step 1",
    text: "do this first",
    createdAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

function pr(overrides: Partial<PRFeedbackComment> = {}): PRFeedbackComment {
  return {
    id: "pr1",
    sessionId: "s1",
    source: "pr-feedback",
    prNumber: 42,
    feedbackType: "review",
    content: "PR feedback body",
    text: "PR feedback body",
    createdAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

describe("bucketComments", () => {
  it("returns empty buckets when sessionId is missing", () => {
    const buckets = bucketComments([diff(), plan(), pr()], null);
    expect(buckets.diff).toHaveLength(0);
    expect(buckets.plan).toHaveLength(0);
    expect(buckets.pr).toHaveLength(0);
  });

  it("filters out comments from other sessions", () => {
    const list: Comment[] = [diff({ sessionId: "s1" }), diff({ id: "d2", sessionId: "s2" })];
    const buckets = bucketComments(list, "s1");
    expect(buckets.diff).toHaveLength(1);
    expect(buckets.diff[0].id).toBe("d1");
  });

  it("groups by source", () => {
    const buckets = bucketComments([diff(), plan(), pr()], "s1");
    expect(buckets.diff).toHaveLength(1);
    expect(buckets.plan).toHaveLength(1);
    expect(buckets.pr).toHaveLength(1);
  });
});

describe("buildComposerPayload", () => {
  it("returns empty string when no body and no chips", () => {
    expect(buildComposerPayload({ diff: [], plan: [], pr: [] }, "")).toBe("");
    expect(buildComposerPayload({ diff: [], plan: [], pr: [] }, "   ")).toBe("");
  });

  it("returns trimmed body when no chips", () => {
    expect(buildComposerPayload({ diff: [], plan: [], pr: [] }, "  hello\n")).toBe("hello");
  });

  it("prepends review-comments markdown then body", () => {
    const out = buildComposerPayload({ diff: [diff()], plan: [], pr: [] }, "do it");
    expect(out).toContain("### Review Comments");
    expect(out).toContain("rename x");
    expect(out.endsWith("do it")).toBe(true);
  });

  it("stacks pr, plan, and body in expected order", () => {
    const out = buildComposerPayload({ diff: [], plan: [plan()], pr: [pr()] }, "freeform message");
    const prIdx = out.indexOf("### PR Feedback");
    const planIdx = out.indexOf("### Plan Comments");
    const bodyIdx = out.indexOf("freeform message");
    expect(prIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(prIdx);
    expect(bodyIdx).toBeGreaterThan(planIdx);
  });

  it("omits the body section when empty but still ships chips", () => {
    const out = buildComposerPayload({ diff: [diff()], plan: [], pr: [] }, "");
    expect(out).toContain("rename x");
    // No trailing freeform text — last segment is the closing --- from the formatter.
    expect(out.trimEnd().endsWith("---")).toBe(true);
  });
});
