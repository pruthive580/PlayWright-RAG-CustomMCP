import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * CartPage — the shopping cart review screen.
 */
export class CartPage extends BasePage {
  protected readonly path = '/cart.html';

  readonly items: Locator;
  readonly checkoutButton: Locator;
  readonly continueShoppingButton: Locator;

  constructor(page: Page) {
    super(page);
    this.items = page.locator('.cart_item');
    this.checkoutButton = page.locator('[data-test="checkout"]');
    this.continueShoppingButton = page.locator('[data-test="continue-shopping"]');
  }

  /** Number of line items in the cart. */
  async itemCount(): Promise<number> {
    return this.items.count();
  }

  /** Names of the products currently in the cart. */
  async itemNames(): Promise<string[]> {
    return this.items.locator('.inventory_item_name').allTextContents();
  }

  /** Proceed to checkout. */
  async checkout(): Promise<void> {
    await this.checkoutButton.click();
  }
}
