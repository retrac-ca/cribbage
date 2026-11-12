import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

function testPassword() { return `RETRAC-test-${randomBytes(24).toString("base64url")}`; }

test("account, persistent complete game, history, stats, and logout", async ({ page, browser }) => {
  const email = `player-${Date.now()}@example.com`;
  const password = testPassword();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /a better hand/i })).toBeVisible();
  await page.getByRole("link", { name: /join the table/i }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Your name").fill("Test Player");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /create my account/i }).click();
  await expect(page.getByRole("heading", { name: /good .* test/i })).toBeVisible();
  const sessionCookie = (await page.context().cookies()).find(cookie => cookie.name === "__Secure-retrac_session");
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

  await page.getByLabel("PLAY AGAINST").selectOption("easy");
  await page.getByRole("button", { name: /deal me in/i }).click();
  await expect(page.getByRole("heading", { name: /build your hand/i })).toBeVisible();
  let snapshot = await page.evaluate(async () => (await fetch("/api/games/active")).json());
  const gameId = snapshot.game.id as string;
  expect(snapshot.game.hands[1]).toHaveLength(0);
  expect(snapshot.game.computerCardCount).toBe(6);
  expect(snapshot.game).not.toHaveProperty("deck");
  expect(snapshot.game).not.toHaveProperty("showHands");
  const secondGame = await page.evaluate(async () => (await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ difficulty: "hard" }) })).status);
  expect(secondGame).toBe(409); // Only one active game is allowed per account.

  // Saving is authoritative: refresh resumes the same game; invalid or stale actions do not advance it.
  await page.reload();
  await expect(page.getByRole("heading", { name: /build your hand/i })).toBeVisible();
  const initialRevision = snapshot.game.revision as number;
  const active = await page.evaluate(async () => (await fetch("/api/games/active")).json());
  expect(active.game.id).toBe(gameId);
  expect(active.game.revision).toBe(initialRevision);

  const discardCards = page.locator(".player-cards button");
  await discardCards.nth(0).click();
  await discardCards.nth(1).click();
  await page.getByRole("button", { name: /discard selected/i }).click();
  await expect(page.getByRole("heading", { name: /the pegging run/i })).toBeVisible();
  const invalidMove = await page.evaluate(async ({ id, revision }) => {
    const response = await fetch(`/api/games/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "play", revision, cardId: "not-in-your-hand" }) });
    return { status: response.status, body: await response.json() };
  }, { id: gameId, revision: initialRevision + 1 });
  expect(invalidMove.status).toBe(400);
  const duplicateMove = await page.evaluate(async ({ id, revision }) => {
    const response = await fetch(`/api/games/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard", revision, cardIds: ["old-card-1", "old-card-2"] }) });
    return response.status;
  }, { id: gameId, revision: initialRevision });
  expect(duplicateMove).toBe(409);

  snapshot = await page.evaluate(async () => (await fetch("/api/games/active")).json());
  expect(snapshot.game.hands[1]).toHaveLength(0);
  expect(snapshot.game.computerCardCount).toBeGreaterThanOrEqual(3); // The computer may open pegging when it is the pone.
  expect(snapshot.game.computerCardCount).toBeLessThanOrEqual(4);
  expect(snapshot.game).not.toHaveProperty("deck");
  expect(snapshot.game).not.toHaveProperty("showHands");
  await page.reload();
  await expect(page.getByRole("heading", { name: /the pegging run/i })).toBeVisible();

  const revision = async () => Number(await page.locator(".game-layout").getAttribute("data-revision"));
  const waitForNextRevision = async (before: number) => expect.poll(revision, { timeout: 5_000 }).toBeGreaterThan(before);
  // Play via the actual interface until one player reaches 121. Each request is validated and saved by the Worker.
  for (let step = 0; step < 900; step++) {
    const finished = await page.locator(".game-finished-actions").count();
    if (finished) break;
    const before = await revision();
    const countButton = page.getByRole("button", { name: /count the hands/i });
    if (await countButton.count()) { await countButton.click(); await waitForNextRevision(before); continue; }
    const discardButton = page.getByRole("button", { name: /discard selected/i });
    if (await discardButton.count()) {
      const cards = page.locator(".player-cards button");
      await cards.nth(0).click(); await cards.nth(1).click(); await discardButton.click();
      await waitForNextRevision(before);
      continue;
    }
    const playable = page.locator(".player-cards button:not(:disabled)");
    if (await playable.count()) { await playable.first().click(); await waitForNextRevision(before); continue; }
    const go = page.getByRole("button", { name: /say go/i });
    if (await go.count()) { await go.click(); await waitForNextRevision(before); continue; }
    const current = await page.evaluate(async () => (await (await fetch("/api/games/active")).json()).game);
    throw new Error(`No legal interface action at step ${step}; phase=${current?.phase}, turn=${current?.turn}, count=${current?.count}`);
  }
  await expect(page.locator(".game-finished-actions")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".final-result")).toContainText(/victory|good game/i);
  const postGameAction = await page.evaluate(async ({ id, revision }) => (await fetch(`/api/games/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "show", revision }) })).status, { id: gameId, revision: Number(await page.locator(".game-layout").getAttribute("data-revision")) });
  expect(postGameAction).toBe(409);
  await page.getByRole("link", { name: /your game book/i }).click();
  await expect(page.getByRole("heading", { name: /your game book/i })).toBeVisible();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.locator(".history-stats")).toContainText("1");
  await page.goto("/");
  await expect(page.getByText(/games played/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /resume game/i })).toHaveCount(0);
  const signOutResponse = page.waitForResponse(response => response.url().endsWith("/api/auth/sign-out") && response.request().method() === "POST");
  await page.getByRole("button", { name: /log out/i }).click();
  expect((await signOutResponse).ok()).toBe(true);
  await page.goto("/game");
  await expect(page).toHaveURL(/\/login$/);
  const clearedSession = await page.evaluate(async () => (await fetch("/api/auth/get-session")).json());
  expect(clearedSession).toBeNull();
  await page.getByRole("link", { name: /forgot password/i }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: /send reset link/i }).click();
  const emailDeliveryConfigured = await page.evaluate(async () => (await (await fetch("/api/config")).json()).emailDeliveryConfigured);
  if (emailDeliveryConfigured) await expect(page.getByText(/if an account exists/i)).toBeVisible();
  else await expect(page.getByRole("alert")).toContainText(/email is not configured/i);
  await page.getByRole("link", { name: /back to log in/i }).click();

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Definitely wrong password");
  await page.getByRole("button", { name: /^log in/i }).click();
  await expect(page.getByRole("alert")).toContainText(/invalid|incorrect|password/i);

  // A real password login restores the persisted account and history.
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^log in/i }).click();
  await expect(page.getByRole("heading", { name: /good .* test/i })).toBeVisible();
  await page.goto("/account");
  await page.getByLabel("Display name").fill("Returning Player");
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByText("Returning Player")).toBeVisible();

  // A different authenticated account cannot read the first player's game record.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto("/register");
  await otherPage.getByLabel("Email address").fill(`other-${Date.now()}@example.com`);
  await otherPage.getByLabel("Your name").fill("Other Player");
  await otherPage.getByLabel("Password", { exact: true }).fill(password);
  await otherPage.getByLabel("Confirm password").fill(password);
  await otherPage.getByRole("button", { name: /create my account/i }).click();
  await expect(otherPage.getByRole("heading", { name: /good .* other/i })).toBeVisible();
  const privateGameStatus = await otherPage.evaluate(async id => (await fetch(`/api/games/${id}`)).status, gameId);
  expect(privateGameStatus).toBe(404);
  await otherPage.goto("/account");
  otherPage.on("dialog", dialog => dialog.accept());
  await otherPage.getByLabel("Confirm with your password").fill(password);
  await otherPage.getByRole("button", { name: /delete my account/i }).click();
  await expect(otherPage).toHaveURL(new URL("/", otherPage.url()).href);
  await otherContext.close();

  // Deleting an account with persisted history removes its associated game records too.
  await page.goto("/account");
  await page.getByLabel("Confirm with your password").fill(password);
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: /delete my account/i }).click();
  await expect(page).toHaveURL(new URL("/", page.url()).href);
  expect(await page.evaluate(async () => (await fetch("/api/auth/get-session")).json())).toBeNull();
});

test("a phone-sized viewport remains navigable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /a better hand/i })).toBeVisible();
  await page.getByRole("link", { name: /join the table/i }).click();
  await expect(page.getByRole("heading", { name: /pull up a chair/i })).toBeVisible();
  const password = testPassword();
  await page.getByLabel("Email address").fill(`mobile-${Date.now()}@example.com`);
  await page.getByLabel("Your name").fill("Mobile Player");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /create my account/i }).click();
  await expect(page.getByRole("heading", { name: /good .* mobile/i })).toBeVisible();
  await page.getByRole("button", { name: /deal me in/i }).click();
  await expect(page.getByRole("heading", { name: /build your hand/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const hand = page.locator(".player-cards button");
  await hand.nth(0).click(); await hand.nth(1).click();
  await page.getByRole("button", { name: /discard selected/i }).click();
  await expect(page.getByRole("heading", { name: /the pegging run/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/account");
  await page.getByLabel("Confirm with your password").fill(password);
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: /delete my account/i }).click();
  await expect(page).toHaveURL(new URL("/", page.url()).href);
});

test("Better Auth uses a secure host-only session cookie", async ({ page }) => {
  const email = `cookie-${Date.now()}@example.invalid`;
  const password = testPassword();
  let registered = false;
  try {
    await page.goto("/register");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Your name").fill("Cookie Check");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    const signup = page.waitForResponse(response => response.url().endsWith("/api/auth/sign-up/email") && response.request().method() === "POST");
    await page.getByRole("button", { name: /create my account/i }).click();
    registered = (await signup).ok();
    await expect(page.getByRole("heading", { name: /good .* cookie/i })).toBeVisible();

    const cookie = (await page.context().cookies()).find(item => item.name === "__Secure-retrac_session");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(cookie?.domain).toBe(new URL(page.url()).hostname);
  } finally {
    if (registered) {
      await page.goto("/account");
      page.on("dialog", dialog => dialog.accept());
      await page.getByLabel("Confirm with your password").fill(password);
      const deletion = page.waitForResponse(response => response.url().endsWith("/api/auth/delete-user") && response.request().method() === "POST");
      await page.getByRole("button", { name: /delete my account/i }).click();
      expect((await deletion).ok()).toBe(true);
    }
  }
});
