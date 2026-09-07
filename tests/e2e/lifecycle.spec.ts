import { expect, test, type Page } from "@playwright/test";

async function runAction(page: Page, action: string) {
  await page.getByTestId(action).click();
  await expect(page.getByTestId(`event-${action}`)).toBeVisible();
}

test("rehearses the locked party-room lifecycle", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("playground")).toBeVisible();
  await expect(page.getByTestId("room-code")).toHaveText("----");

  const soundToggle = page.getByTestId("sound-toggle");
  await expect(soundToggle).toBeVisible();
  await expect(soundToggle).toContainText("Sound on");
  await soundToggle.click();
  await expect(soundToggle).toContainText("Muted");
  await soundToggle.click();
  await expect(soundToggle).toContainText("Sound on");

  const createRoomButton = page.getByTestId("create-room");
  await expect(createRoomButton).toHaveAttribute("data-cuelume-press");
  await expect(createRoomButton).toHaveAttribute("data-cuelume-release");
  await runAction(page, "create-room");
  await expect(page.getByTestId("room-code")).toHaveText("B7Q2");
  await expect(page.getByTestId("current-host")).toHaveText("Ari");

  await runAction(page, "add-second-player");

  await runAction(page, "start-cycle-one");
  await expect(page.getByTestId("cycle-number")).toHaveText("1");
  await expect(page.getByTestId("match-status")).toContainText("Cycle 1");
  await expect(page.getByTestId("seat-1")).toContainText("Ari");
  await expect(page.getByTestId("seat-2")).toContainText("Bea");

  await runAction(page, "add-late-spectator");
  await expect(page.getByTestId("queued-spectator")).toHaveAttribute("data-state", "queued");
  await expect(page.getByTestId("queued-spectator")).toContainText("Cal");
  await expect(page.getByTestId("seat-3")).toHaveAttribute("aria-label", "Seat 3, open");

  await runAction(page, "make-host-stale");
  await expect(page.getByTestId("current-host")).toHaveText("Ari");

  await runAction(page, "migrate-host");
  await expect(page.getByTestId("current-host")).toHaveText("Bea");

  await runAction(page, "complete-match");
  await expect(page.getByTestId("envelope-status")).toHaveText("No active envelope");

  await runAction(page, "begin-cycle-two");
  await expect(page.getByTestId("cycle-number")).toHaveText("2");
  await expect(page.getByTestId("queued-spectator")).toHaveAttribute("data-state", "seated");
  await expect(page.getByTestId("seat-3")).toContainText("Cal");
  await expect(page.getByTestId("match-status")).toContainText("Cycle 2");
  await expect(page.getByTestId("event-ledger")).toContainText("8 moves");
});
