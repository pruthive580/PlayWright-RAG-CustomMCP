import { test, expect } from '../../src/fixtures/test-fixtures';
import { products } from '../../src/data/products';

/**
 * End-to-end checkout test.
 * Exercises the full journey across four page objects:
 * login -> inventory -> cart -> checkout -> confirmation.
 */
test.describe('Checkout E2E', () => {
  test('completes a purchase from login to confirmation @e2e', async ({
    loggedIn,
    cartPage,
    checkoutPage,
  }) => {
    await loggedIn.addToCart(products.backpack);
    await loggedIn.addToCart(products.boltTshirt);
    await loggedIn.openCart();

    expect(await cartPage.itemCount()).toBe(2);
    await cartPage.checkout();

    await checkoutPage.fillInformation('Bhargav', 'Tester', '46000');
    await checkoutPage.continue();

    expect(await checkoutPage.totalText()).toContain('Total: $');
    await checkoutPage.finish();
    await checkoutPage.expectComplete();
  });
});
