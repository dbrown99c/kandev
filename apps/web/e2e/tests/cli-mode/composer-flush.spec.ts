import { test, expect } from "../../fixtures/test-base";
import { KanbanPage } from "../../pages/kanban-page";
import { SessionPage } from "../../pages/session-page";

/**
 * CLI-mode buffered composer.
 *
 * Passthrough sessions render a multi-line composer below the xterm.js
 * terminal. The composer batches free-form text + pending review comments
 * and flushes them to PTY stdin via the agent.stdin WS action with
 * append_submit=true (backend appends the agent's SubmitSequence).
 *
 * This spec verifies:
 *   1. The composer is visible in passthrough sessions and hidden in ACP mode.
 *   2. Typing into the composer + clicking Send writes the text to the
 *      terminal buffer and triggers a "working" badge transition.
 */
test.describe("CLI mode: buffered passthrough composer", () => {
  test("composer flushes free-form text to the PTY and triggers working state", async ({
    testPage,
    apiClient,
    seedData,
  }) => {
    const { agents } = await apiClient.listAgents();
    if (agents.length === 0) throw new Error("no agents registered");

    const profile = await apiClient.createAgentProfile(agents[0].id, "Composer Flush Test", {
      model: "mock-fast",
      auto_approve: true,
      cli_passthrough: true,
    });

    await apiClient.createTaskWithAgent(seedData.workspaceId, "Composer Flush Task", profile.id, {
      description: "Initial task description",
      workflow_id: seedData.workflowId,
      workflow_step_id: seedData.startStepId,
      repository_ids: [seedData.repositoryId],
    });

    const kanban = new KanbanPage(testPage);
    await kanban.goto();
    const card = kanban.taskCardByTitle("Composer Flush Task");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await expect(testPage).toHaveURL(/\/t\//, { timeout: 15_000 });

    const session = new SessionPage(testPage);
    await session.waitForPassthroughLoad(20_000);
    await session.waitForPassthroughLoaded(20_000);

    // The composer mounts immediately under the terminal in passthrough mode.
    const composer = testPage.getByTestId("passthrough-composer");
    await expect(composer).toBeVisible({ timeout: 10_000 });

    // Wait for the agent's initial "waiting" so the first auto-injected prompt
    // is already processed — otherwise our composer flush races the
    // initial-prompt injection and the test asserts ambiguously about which
    // write reached the PTY first.
    await expect(testPage.getByTestId(/passthrough-hook-state-/)).toHaveText("waiting", {
      timeout: 20_000,
    });
    await session.expectPassthroughHasText("Processed:", 20_000);

    const flushMessage = "Refactor the pagination helper";
    const input = testPage.getByTestId("passthrough-composer-input");
    await input.fill(flushMessage);

    const sendBtn = testPage.getByTestId("passthrough-composer-send");
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // The mock TUI echoes "Processed: <prompt>" — the flushed body should now
    // be visible in the terminal buffer.
    await session.expectPassthroughHasText(flushMessage, 15_000);

    // UserPromptSubmit fires while the mock processes — the badge transitions
    // to "working" once the TUI picks up the new line.
    await expect(testPage.getByTestId(/passthrough-hook-state-/)).toHaveText("working", {
      timeout: 15_000,
    });

    // Composer draft is cleared on successful send.
    await expect(input).toHaveValue("");
  });

  test("composer is hidden in ACP (non-passthrough) sessions", async ({
    testPage,
    apiClient,
    seedData,
  }) => {
    const { agents } = await apiClient.listAgents();
    if (agents.length === 0) throw new Error("no agents registered");

    const profile = await apiClient.createAgentProfile(agents[0].id, "ACP Profile (no composer)", {
      model: "mock-fast",
      auto_approve: true,
      // cli_passthrough left false — this is the ACP path with the
      // TipTap chat composer, not the buffered passthrough composer.
    });

    await apiClient.createTaskWithAgent(seedData.workspaceId, "ACP Mode Task", profile.id, {
      description: "ACP task",
      workflow_id: seedData.workflowId,
      workflow_step_id: seedData.startStepId,
      repository_ids: [seedData.repositoryId],
    });

    const kanban = new KanbanPage(testPage);
    await kanban.goto();
    const card = kanban.taskCardByTitle("ACP Mode Task");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await expect(testPage).toHaveURL(/\/t\//, { timeout: 15_000 });

    // The passthrough composer must NOT be rendered for ACP sessions; the
    // TipTap chat composer handles input via message.add instead.
    await expect(testPage.getByTestId("passthrough-composer")).toHaveCount(0);
  });
});
