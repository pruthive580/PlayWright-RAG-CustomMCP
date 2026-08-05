import { test, expect } from '../../src/fixtures/test-fixtures';

/**
 * Smoke — the lowest tier of the pyramid.
 * Proves the app is reachable and the sign-in form renders before any
 * deeper suite runs.
 *
 * Playwright features shown: navigation, web-first visibility assertions
 * (auto-waiting), and a URL assertion — all through page-object locators,
 * never raw `page.*`.
 */
test.describe('Smoke', () => {
  test('login page loads and shows the sign-in form @smoke', async ({ loginPage }) => {
    await loginPage.goto();

    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeEnabled();

    expect(loginPage.url()).toContain('saucedemo.com');
  });
});
