import { Page, Locator, expect } from '@playwright/test';

/**
 * BasePage holds behaviour common to every page object:
 * a reference to the Playwright Page, navigation, and shared helpers.
 * Each concrete page declares its own relative `path`.
 */
export abstract class BasePage {
  protected readonly page: Page;
  protected abstract readonly path: string;

  constructor(page: Page) {
    this.page = page;
  }

  /** Navigate to this page's path (resolved against baseURL). */
  async goto(): Promise<void> {
    await this.page.goto(this.path);
  }

  /** Assert a locator is visible before interacting with it. */
  async waitForVisible(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
  }

  /** Return the current browser URL. */
  url(): string {
    return this.page.url();
  }
}
