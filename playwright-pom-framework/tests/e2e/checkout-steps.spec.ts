import { test, expect } from '../../src/fixtures/test-fixtures';
import { products } from '../../src/data/products';

/**
 * Checkout journey — the complex tier. A full multi-item purchase across
 * four page objects, with rich reporting.
 *
 * Playwright features shown:
 *  - test.step(...) to structure the flow into readable, reported phases
 *  - a custom annotation on TestInfo (suite/severity metadata)
 *  - cross-page state verification (cart contents == what was added)
 *  - numeric parsing + assertion on the order total
 *  - expect.arrayContaining for order-independent list checks
 */
test.describe('Checkout journey', () => {
  test('buys multiple items and verifies the order summary @e2e', async (
    { loggedIn, cartPage, checkoutPage },
    testInfo,
  ) => {
    testInfo.annotations.push({ type: 'severity', description: 'revenue-critical' });
    const chosen = [products.backpack, products.fleeceJacket];

    await test.step('add items from the inventory', async () => {
      for (const item of chosen) await loggedIn.addToCart(item);
      await expect.poll(() => loggedIn.cartCount()).toBe(chosen.length);
    });

    await test.step('review the cart', async () => {
      await loggedIn.openCart();
      expect(await cartPage.itemCount()).toBe(chosen.length);
      expect(await cartPage.itemNames()).toEqual(expect.arrayContaining(chosen));
      await cartPage.checkout();
    });

    await test.step('provide buyer information', async () => {
      await checkoutPage.fillInformation('Bhargav', 'Tester', '500001');
      await checkoutPage.continue();
    });

    await test.step('verify the total and finish the order', async () => {
      const total = await checkoutPage.totalText();
      expect(total).toContain('Total: $');
      const amount = Number(total.replace(/[^0-9.]/g, ''));
      expect(amount).toBeGreaterThan(0);

      await checkoutPage.finish();
      await checkoutPage.expectComplete();
    });
  });
});
