import { test, expect } from '../../src/fixtures/test-fixtures';
import { products } from '../../src/data/products';
import type { SortOption } from '../../src/pages/InventoryPage';

/**
 * Catalog — medium tier. Product-list integrity and every sort order.
 *
 * Playwright features shown:
 *  - locator counting (how many products render)
 *  - soft assertions (expect.soft) so one bad price doesn't hide the rest
 *  - data-driven parametrization over ALL four sort orders
 *  - expect.poll to auto-retry an async read until it settles
 */
const EXPECTED_PRODUCTS = 6;

test.describe('Catalog integrity', () => {
  test('renders the full product catalog with valid prices @functional', async ({ loggedIn }) => {
    const names = await loggedIn.itemNames();
    expect(names.length).toBe(EXPECTED_PRODUCTS);

    const prices = await loggedIn.prices();
    expect(prices.length).toBe(EXPECTED_PRODUCTS);
    // Soft: report every non-positive price instead of failing on the first.
    for (const price of prices) {
      expect.soft(price, `price ${price} should be positive`).toBeGreaterThan(0);
    }
  });

  const nameSorts = [
    { option: 'az' as SortOption, label: 'name A to Z', expected: (n: string[]) => [...n].sort() },
    { option: 'za' as SortOption, label: 'name Z to A', expected: (n: string[]) => [...n].sort().reverse() },
  ];
  for (const { option, label, expected } of nameSorts) {
    test(`sorts by ${label} @functional`, async ({ loggedIn }) => {
      await loggedIn.sortBy(option);
      const names = await loggedIn.itemNames();
      expect(names).toEqual(expected(names));
    });
  }

  const priceSorts = [
    { option: 'lohi' as SortOption, label: 'price low to high', expected: (p: number[]) => [...p].sort((a, b) => a - b) },
    { option: 'hilo' as SortOption, label: 'price high to low', expected: (p: number[]) => [...p].sort((a, b) => b - a) },
  ];
  for (const { option, label, expected } of priceSorts) {
    test(`sorts by ${label} @functional`, async ({ loggedIn }) => {
      await loggedIn.sortBy(option);
      const prices = await loggedIn.prices();
      expect(prices).toEqual(expected(prices));
    });
  }

  test('cart badge eventually reflects items added @functional', async ({ loggedIn }) => {
    await loggedIn.addToCart(products.backpack);
    await loggedIn.addToCart(products.bikeLight);
    // expect.poll re-invokes the async reader until the matcher passes.
    await expect.poll(() => loggedIn.cartCount()).toBe(2);
  });
});
