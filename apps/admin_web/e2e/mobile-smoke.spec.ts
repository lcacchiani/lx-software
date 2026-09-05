import { expect, test, type Page } from "@playwright/test";

async function pageHasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

test.describe("admin viewport smoke", () => {
  test("dashboard loads fixture summaries", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("HSBC HK current").or(page.getByText("Hillmarton"))).toBeVisible();
    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });

  test("finance accounts keep name, balance, and stale warning on phones", async ({
    page,
  }, testInfo) => {
    await page.goto("/finance");
    await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
    await expect(page.getByText("HSBC HK current")).toBeVisible();
    await expect(page.getByText("128,430.50").or(page.getByText("128430.5"))).toBeVisible();
    await expect(page.getByText("Stale")).toBeVisible();

    if (testInfo.project.name === "phone") {
      await expect(page.getByLabel("Finance sections")).toBeVisible();
      await expect(page.getByLabel("Sort by")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /Account Type/i })).toBeHidden();
    } else {
      await expect(page.getByRole("tab", { name: "Accounts" })).toBeVisible();
    }
    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });

  test("investments keep current value on phones", async ({ page }, testInfo) => {
    await page.goto("/finance");
    if (testInfo.project.name === "phone") {
      await page.getByLabel("Finance sections").selectOption("investments");
    } else {
      await page.getByRole("tab", { name: "Investments" }).click();
    }
    await expect(page.getByText("Hillmarton Road")).toBeVisible();
    await expect(page.getByText("512,000").or(page.getByText("512000"))).toBeVisible();
    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });

  test("banking shows expiring consent on phones", async ({ page }, testInfo) => {
    await page.goto("/banking");
    await expect(page.getByRole("heading", { name: "Banking" })).toBeVisible();
    await expect(page.getByText("Monzo")).toBeVisible();
    if (testInfo.project.name === "phone") {
      await expect(page.getByText(/Consent expires/i).or(page.getByText(/Consent valid/i))).toBeVisible();
    } else {
      await expect(page.getByRole("columnheader", { name: /Consent valid until/i })).toBeVisible();
    }
    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });

  test("siu tin dei board sections stay reachable", async ({ page }, testInfo) => {
    await page.goto("/siu-tin-dei");
    await expect(page.getByRole("heading", { name: "Siu Tin Dei" })).toBeVisible();
    if (testInfo.project.name === "phone") {
      await page.getByLabel("Siu Tin Dei sections").selectOption("board");
    } else {
      await page.getByRole("tab", { name: "Executive Board" }).click();
    }
    await expect(page.getByText(/Ship the provider onboarding form/i)).toBeVisible();
    if (testInfo.project.name === "phone") {
      await expect(page.getByLabel("Board sections")).toBeVisible();
    } else {
      await expect(page.getByRole("tab", { name: /Next actions/ })).toBeVisible();
    }
    expect(await pageHasHorizontalOverflow(page)).toBe(false);
  });
});
