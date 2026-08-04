import { test, expect } from '../../src/fixtures/test-fixtures';
import { products } from '../../src/data/products';

test.describe('Cart removal', () => {
  test('removing an item decrements the cart badge @functional', async ({ loggedIn }) => {
    await loggedIn.addToCart(products.backpack);
    await loggedIn.addToCart(products.bikeLight);
    expect(await loggedIn.cartCount()).toBe(2);

    await loggedIn.removeFromCart(products.backpack);
    expect(await loggedIn.cartCount()).toBe(1);
  });
});
