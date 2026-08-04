import { test, expect } from '../../src/fixtures/test-fixtures';
import { products } from '../../src/data/products';

/**
 * Inventory tests.
 * Functional/state checks over the product list: add-to-cart badge
 * counting and the two sort orders. Each test starts from an
 * authenticated session via the `loggedIn` fixture.
 */
test.describe('Inventory', () => {
  test('adds items to the cart and updates the badge @functional', async ({ loggedIn }) => {
    await loggedIn.addToCart(products.backpack);
    await loggedIn.addToCart(products.bikeLight);
    expect(await loggedIn.cartCount()).toBe(2);
  });

  test('sorts products by price low to high @functional', async ({ loggedIn }) => {
    await loggedIn.sortBy('lohi');
    const prices = await loggedIn.prices();
    const expected = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(expected);
  });

  test('sorts products by name Z to A @functional', async ({ loggedIn }) => {
    await loggedIn.sortBy('za');
    const names = await loggedIn.itemNames();
    const expected = [...names].sort().reverse();
    expect(names).toEqual(expected);
  });
});
