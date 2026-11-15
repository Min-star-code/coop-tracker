import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "./fixtures";

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "To apply" })).toBeVisible();
}

test("wrong password shows an error and stays on the login page", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(ACCOUNTS.owner.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("wrong email or password");
});

test("owner: overview counts, filter, change status, timeline", async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.locator(".stat").first()).toContainText("7");

  await page.getByRole("link", { name: "Applications" }).click();
  await page.getByRole("button", { name: "Applied", exact: true }).click();
  await expect(page.getByTestId("result-count")).toHaveText("3 results");

  await page.getByLabel("Search").fill("northwind");
  await expect(page.getByTestId("result-count")).toHaveText("1 result");
  await page.getByText("QA Automation Co-op").click();

  const drawer = page.getByRole("dialog", { name: "Application details" });
  await drawer.getByLabel("Status").selectOption("Interview");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByText("Saved.")).toBeVisible();
  await expect(drawer.locator(".timeline li").last()).toHaveText(/Applied → Interview/);
});

test("viewer: read-only, no classifier", async ({ page }) => {
  await signIn(page, ACCOUNTS.viewer);
  await expect(page.getByRole("link", { name: "Classify a posting" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tailor resume" })).toHaveCount(0);

  await page.getByRole("link", { name: "Applications" }).click();
  await page.getByText("SDET Intern").click();
  const drawer = page.getByRole("dialog", { name: "Application details" });
  await expect(drawer.getByText("Read-only access.")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("owner: classify a posting (fake LLM)", async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.getByRole("link", { name: "Classify a posting" }).click();
  await page.getByLabel("Job posting").fill("Software QA Co-op, Kitchener, Ontario. Hybrid. Write Playwright tests for our web app.");
  await page.getByRole("button", { name: "Classify" }).click();
  await expect(page.getByTestId("classification")).toContainText("Waterloo region");
});

test("owner: Today queue, most urgent first; Applied and Skip remove the card and count", async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  const items = page.getByTestId("queue-item");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Junior Developer"); // due in 2 days, before the 6-day one
  await expect(items.first()).toContainText("cover letter required");

  await items.first().getByRole("button", { name: "Applied" }).click();
  await expect(items).toHaveCount(1);
  await expect(page.getByTestId("week")).toContainText("1 applied");

  await items.first().getByRole("button", { name: "Skip" }).click();
  await page.getByLabel("Skip reason").selectOption("Location");
  await expect(items).toHaveCount(0);
  await expect(page.getByTestId("week")).toContainText("1 skipped");
});

test("owner: tailor resume shows my own stored bullet with its source (fake RAG)", async ({ page }) => {
  await signIn(page, ACCOUNTS.owner);
  await page.getByRole("link", { name: "Tailor resume" }).click();
  await page.getByLabel("Job posting").fill("Software QA co-op. You will write Playwright tests and keep the CI pipeline green.");
  await page.getByRole("button", { name: "Suggest" }).click();
  const pick = page.getByTestId("pick");
  await expect(pick).toHaveCount(1);
  await expect(pick).toContainText("Sample Project");
  await expect(pick).toContainText("Wrote 12 Playwright end-to-end tests");
  await expect(page.getByTestId("tailoring")).toContainText("WW 400001");
});
