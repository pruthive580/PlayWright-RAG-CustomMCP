import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * CheckoutPage — covers both checkout steps (information + overview)
 * and the final confirmation screen.
 */
export class CheckoutPage extends BasePage {
  protected readonly path = '/checkout-step-one.html';

  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly postalCodeInput: Locator;
  readonly continueButton: Locator;
  readonly finishButton: Locator;
  readonly completeHeader: Locator;
  readonly summaryTotal: Locator;

  constructor(page: Page) {
    super(page);
    this.firstNameInput = page.locator('[data-test="firstName"]');
    this.lastNameInput = page.locator('[data-test="lastName"]');
    this.postalCodeInput = page.locator('[data-test="postalCode"]');
    this.continueButton = page.locator('[data-test="continue"]');
    this.finishButton = page.locator('[data-test="finish"]');
    this.completeHeader = page.locator('.complete-header');
    this.summaryTotal = page.locator('.summary_total_label');
  }

  /** Fill the buyer information form (step one). */
  async fillInformation(firstName: string, lastName: string, postalCode: string): Promise<void> {
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    await this.postalCodeInput.fill(postalCode);
  }

  /** Continue from information to the order overview. */
  async continue(): Promise<void> {
    await this.continueButton.click();
  }

  /** Finish the order from the overview screen. */
  async finish(): Promise<void> {
    await this.finishButton.click();
  }

  /** Assert the order-complete confirmation is shown. */
  async expectComplete(): Promise<void> {
    await expect(this.completeHeader).toHaveText('Thank you for your order!');
  }

  /** The order total displayed on the overview screen (e.g. "Total: $39.98"). */
  async totalText(): Promise<string> {
    return (await this.summaryTotal.innerText()).trim();
  }
}
