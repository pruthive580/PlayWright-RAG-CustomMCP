import { test } from '../../src/fixtures/test-fixtures';
import { users, invalidLogins } from '../../src/data/users';

/**
 * Authentication tests.
 * Demonstrates a positive smoke check plus a data-driven set of
 * negative cases generated from `invalidLogins`.
 */
test.describe('Authentication', () => {
  test('standard user can log in @smoke', async ({ loginPage, inventoryPage }) => {
    await loginPage.goto();
    await loginPage.login(users.standard.username, users.standard.password);
    await inventoryPage.expectLoaded();
  });

  for (const scenario of invalidLogins) {
    test(`rejects login: ${scenario.name} @negative`, async ({ loginPage }) => {
      await loginPage.goto();
      await loginPage.login(scenario.username, scenario.password);
      await loginPage.expectError(scenario.error);
    });
  }
});
