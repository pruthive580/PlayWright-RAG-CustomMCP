import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export type SortOption = 'az' | 'za' | 'lohi' | 'hilo';

/**
 * InventoryPage — the product listing shown after a successful login.
 * Exposes add-to-cart, sorting, and read helpers for names/prices.
 */
export class InventoryPage extends BasePage {
  protected readonly path = '/inventory.html';

  readonly title: Locator;
  readonly sortDropdown: Locator;
  readonly cartLink: Locator;
  readonly cartBadge: Locator;

  constructor(page: Page) {
    super(page);
    this.title = page.locator('.title');
    this.sortDropdown = page.locator('[data-test="product-sort-container"]');
    this.cartLink = page.locator('.shopping_cart_link');
    this.cartBadge = page.locator('.shopping_cart_badge');
  }

  /** Assert the inventory page has finished loading. */
  async expectLoaded(): Promise<void> {
    await expect(this.title).toHaveText('Products');
  }

  /** The card element for a product, matched by its visible name. */
  private itemCard(name: string): Locator {
    return this.page.locator('.inventory_item').filter({ hasText: name });
  }

  /** Add a single product to the cart by name. */
  async addToCart(name: string): Promise<void> {
    await this.itemCard(name).getByRole('button', { name: 'Add to cart' }).click();
  }

  /** Remove a single product from the cart by name. */
  async removeFromCart(name: string): Promise<void> {
    await this.itemCard(name).getByRole('button', { name: 'Remove' }).click();
  }

  /** Change the product sort order. */
  async sortBy(option: SortOption): Promise<void> {
    await this.sortDropdown.selectOption(option);
  }

  /** All product names in current display order. */
  async itemNames(): Promise<string[]> {
    return this.page.locator('.inventory_item_name').allTextContents();
  }

  /** All product prices as numbers, in current display order. */
  async prices(): Promise<number[]> {
    const raw = await this.page.locator('.inventory_item_price').allTextContents();
    return raw.map((t) => Number(t.replace('$', '')));
  }

  /** Number shown on the cart badge (0 when the badge is absent). */
  async cartCount(): Promise<number> {
    if ((await this.cartBadge.count()) === 0) return 0;
    return Number(await this.cartBadge.innerText());
  }

  /** Open the cart page. */
  async openCart(): Promise<void> {
    await this.cartLink.click();
  }
}
