"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  IconSend,
  IconX,
  IconChevronDown,
  IconChevronUp,
  IconMessageCircle,
} from "@tabler/icons-react";
import { Button } from "@kandev/ui/button";
import { useAppStore } from "@/components/state-provider";
import { getWebSocketClient } from "@/lib/ws/connection";
import { usePendingComments } from "@/hooks/domains/comments/use-pending-comments";
import {
  useCommentsStore,
  isDiffComment,
  isPlanComment,
  isPRFeedbackComment,
  formatReviewCommentsAsMarkdown,
  formatPlanCommentsAsMarkdown,
  formatPRFeedbackAsMarkdown,
  type Comment,
  type DiffComment,
  type PlanComment,
  type PRFeedbackComment,
} from "@/lib/state/slices/comments";

type ComposerBuckets = {
  diff: DiffComment[];
  plan: PlanComment[];
  pr: PRFeedbackComment[];
};

const EMPTY_BUCKETS: ComposerBuckets = { diff: [], plan: [], pr: [] };

export function bucketComments(
  comments: Comment[],
  sessionId: string | null | undefined,
): ComposerBuckets {
  if (!sessionId || comments.length === 0) return EMPTY_BUCKETS;
  const diff: DiffComment[] = [];
  const plan: PlanComment[] = [];
  const pr: PRFeedbackComment[] = [];
  for (const c of comments) {
    if (c.sessionId !== sessionId) continue;
    if (isDiffComment(c)) diff.push(c);
    else if (isPlanComment(c)) plan.push(c);
    else if (isPRFeedbackComment(c)) pr.push(c);
  }
  return { diff, plan, pr };
}

/**
 * Build the payload that gets written to PTY stdin. Comment markdown is
 * stacked before the freeform body, matching the order used by the ACP chat
 * composer in chat-input-area.tsx. The backend appends the agent's
 * SubmitSequence when append_submit=true, so callers never include `\r`.
 */
export function buildComposerPayload(buckets: ComposerBuckets, body: string): string {
  const parts: string[] = [];
  if (buckets.diff.length > 0) parts.push(formatReviewCommentsAsMarkdown(buckets.diff));
  if (buckets.pr.length > 0) parts.push(formatPRFeedbackAsMarkdown(buckets.pr));
  if (buckets.plan.length > 0) parts.push(formatPlanCommentsAsMarkdown(buckets.plan));
  const trimmedBody = body.trim();
  if (trimmedBody) parts.push(trimmedBody);
  return parts.join("\n\n");
}

function shortPreview(text: string, limit = 40): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : clean.slice(0, limit - 1) + "…";
}

function CommentChip({
  label,
  preview,
  onRemove,
}: {
  label: string;
  preview: string;
  onRemove: () => void;
}) {
  return (
    <div
      data-testid="composer-comment-chip"
      className="group flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground bg-muted/50 rounded border border-border/50 max-w-[260px]"
      title={preview}
    >
      <IconMessageCircle className="h-3 w-3 shrink-0" />
      <span className="truncate">
        <span className="font-medium text-foreground/80">{label}</span>
        {preview && <span className="ml-1 text-muted-foreground">{preview}</span>}
      </span>
      <button
        type="button"
        aria-label="Drop comment"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 ml-0.5 hover:text-foreground cursor-pointer"
      >
        <IconX className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function ComposerToolbar({
  buckets,
  onDrop,
  onClearAll,
}: {
  buckets: ComposerBuckets;
  onDrop: (id: string) => void;
  onClearAll: () => void;
}) {
  const total = buckets.diff.length + buckets.plan.length + buckets.pr.length;
  if (total === 0) return null;
  return (
    <div
      data-testid="composer-toolbar"
      className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 border-b border-border/40"
    >
      {buckets.diff.map((c) => (
        <CommentChip
          key={c.id}
          label={`${c.filePath.split("/").pop() ?? c.filePath}:${c.startLine}`}
          preview={shortPreview(c.text)}
          onRemove={() => onDrop(c.id)}
        />
      ))}
      {buckets.plan.map((c) => (
        <CommentChip
          key={c.id}
          label="Plan"
          preview={shortPreview(c.text)}
          onRemove={() => onDrop(c.id)}
        />
      ))}
      {buckets.pr.map((c) => (
        <CommentChip
          key={c.id}
          label={`PR #${c.prNumber} ${c.feedbackType}`}
          preview={shortPreview(c.content)}
          onRemove={() => onDrop(c.id)}
        />
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer"
      >
        Clear all
      </button>
    </div>
  );
}

function useComposerSubmit(
  sessionId: string | null | undefined,
  buckets: ComposerBuckets,
  draft: string,
  clearComposer: () => void,
) {
  const removeFromPending = useCommentsStore((s) => s.removeFromPending);
  const markCommentsSent = useCommentsStore((s) => s.markCommentsSent);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!sessionId) return;
    const payload = buildComposerPayload(buckets, draft);
    if (!payload) return;
    const client = getWebSocketClient();
    if (!client) return;
    setIsSending(true);
    try {
      await client.request(
        "agent.stdin",
        { session_id: sessionId, data: payload, append_submit: true },
        15_000,
      );
      const bundledIds = [
        ...buckets.diff.map((c) => c.id),
        ...buckets.plan.map((c) => c.id),
        ...buckets.pr.map((c) => c.id),
      ];
      if (bundledIds.length > 0) {
        markCommentsSent(bundledIds);
        // markCommentsSent flips status but the chat pool also tracks
        // pendingForChat — drop bundled IDs from there too so chips disappear.
        for (const id of bundledIds) removeFromPending(id);
      }
      clearComposer();
    } catch (err) {
      console.error("passthrough composer: failed to flush stdin", err);
    } finally {
      setIsSending(false);
    }
  }, [sessionId, buckets, draft, clearComposer, markCommentsSent, removeFromPending]);

  return { handleSubmit, isSending };
}

type PassthroughComposerProps = {
  sessionId: string | null | undefined;
  className?: string;
};

// eslint-disable-next-line max-lines-per-function -- one component with header + body + actions; sub-extraction would obscure flow
export function PassthroughComposer({ sessionId, className }: PassthroughComposerProps) {
  const pendingAll = usePendingComments();
  const buckets = useMemo(() => bucketComments(pendingAll, sessionId), [pendingAll, sessionId]);
  const totalChips = buckets.diff.length + buckets.plan.length + buckets.pr.length;

  const composerState = useAppStore((s) =>
    sessionId ? s.passthroughComposer.bySessionId[sessionId] : undefined,
  );
  const draft = composerState?.draft ?? "";
  const collapsed = composerState?.collapsed ?? false;

  const setDraft = useAppStore((s) => s.setPassthroughComposerDraft);
  const setCollapsed = useAppStore((s) => s.setPassthroughComposerCollapsed);
  const clearComposer = useAppStore((s) => s.clearPassthroughComposer);
  const removeFromPending = useCommentsStore((s) => s.removeFromPending);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleClear = useCallback(() => {
    if (!sessionId) return;
    clearComposer(sessionId);
  }, [sessionId, clearComposer]);

  const { handleSubmit, isSending } = useComposerSubmit(sessionId, buckets, draft, handleClear);

  const handleDropChip = useCallback(
    (id: string) => {
      removeFromPending(id);
    },
    [removeFromPending],
  );

  const handleClearAllChips = useCallback(() => {
    for (const c of [...buckets.diff, ...buckets.plan, ...buckets.pr]) {
      removeFromPending(c.id);
    }
  }, [buckets, removeFromPending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter") return;
      // Shift+Enter inserts a newline; bare Enter and Cmd/Ctrl+Enter submit.
      if (e.shiftKey) return;
      e.preventDefault();
      void handleSubmit();
    },
    [handleSubmit],
  );

  if (!sessionId) return null;

  const canSubmit = !isSending && (draft.trim().length > 0 || totalChips > 0);
  const containerClass = className ?? "shrink-0 border-t border-border bg-background";

  if (collapsed) {
    return (
      <div
        data-testid="passthrough-composer"
        data-collapsed="true"
        className={`${containerClass} flex items-center gap-2 px-2 py-1`}
      >
        <button
          type="button"
          onClick={() => setCollapsed(sessionId, false)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <IconChevronUp className="h-3.5 w-3.5" />
          Write to agent
        </button>
        {totalChips > 0 && (
          <span
            data-testid="composer-collapsed-badge"
            className="text-[10px] font-medium leading-none rounded bg-amber-500/10 text-amber-600 px-1.5 py-0.5"
          >
            {totalChips} comment{totalChips === 1 ? "" : "s"}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="passthrough-composer"
      data-collapsed="false"
      className={`${containerClass} flex flex-col`}
    >
      <ComposerToolbar buckets={buckets} onDrop={handleDropChip} onClearAll={handleClearAllChips} />
      <div className="flex items-end gap-1.5 px-2 py-1.5">
        <textarea
          ref={textareaRef}
          data-testid="passthrough-composer-input"
          value={draft}
          onChange={(e) => setDraft(sessionId, e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write to the agent. Enter sends, Shift+Enter for a newline."
          rows={2}
          className="flex-1 resize-y min-h-[44px] max-h-[200px] text-sm bg-muted/30 border border-border/50 rounded px-2 py-1.5 outline-none focus:border-border"
        />
        <div className="flex flex-col items-stretch gap-1">
          <Button
            type="button"
            size="sm"
            data-testid="passthrough-composer-send"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            className="h-7 px-2 gap-1 cursor-pointer"
          >
            <IconSend className="h-3.5 w-3.5" />
            Send
          </Button>
          <button
            type="button"
            data-testid="passthrough-composer-collapse"
            onClick={() => setCollapsed(sessionId, true)}
            className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
            title="Collapse"
          >
            <IconChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
