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
 *      terminal buffer.
 */
test.describe("CLI mode: buffered passthrough composer", () => {
  test("composer flushes free-form text to the PTY", async ({ testPage, apiClient, seedData }) => {
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

    // Wait for the auto-injected initial prompt to be processed by the mock
    // TUI — "Processed:" only appears after the agent has consumed stdin. This
    // gates the composer flush so it doesn't race the initial-prompt write.
    await session.expectPassthroughHasText("Processed:", 20_000);

    const flushMessage = "Refactor the pagination helper";
    const input = testPage.getByTestId("passthrough-composer-input");
    await input.fill(flushMessage);

    const sendBtn = testPage.getByTestId("passthrough-composer-send");
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // The flushed body should appear in the terminal buffer and be echoed
    // back by the mock TUI as "Processed: <body>".
    await session.expectPassthroughHasText(flushMessage, 15_000);

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
