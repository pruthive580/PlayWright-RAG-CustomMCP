import { chromium, Browser, BrowserContext, Page } from "playwright";

export interface RecordedStep {
  action: "navigate" | "click" | "type" | "select" | "press";
  target?: string;
  value?: string;
  url?: string;
}

interface RawEl {
  tag: string;
  type: string | null;
  role: string | null;
  dataTest: string | null;
  id: string | null;
  name: string | null;
  text: string;
  placeholder: string | null;
}

/** Build a stable Playwright selector for a scraped element, preferring data-test. */
function selectorFor(el: RawEl): string {
  if (el.dataTest) return `[data-test="${el.dataTest}"]`;
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  if (el.placeholder) return `[placeholder="${el.placeholder}"]`;
  if ((el.tag === "button" || el.tag === "a") && el.text) {
    return `${el.tag}:has-text(${JSON.stringify(el.text)})`;
  }
  return el.tag;
}

function describe(el: RawEl): string {
  const role = el.role || el.type || el.tag;
  const label = el.text || el.placeholder || el.name || el.dataTest || "";
  return label ? `${role} "${label}"` : role;
}

/**
 * A persistent browser session shared across MCP tool calls. Mirrors the core
 * of the official Playwright MCP (navigate / snapshot / click / type / screenshot)
 * and records each action so a test can later be generated in the framework's style.
 */
export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private consoleLog: string[] = [];
  private refMap = new Map<string, string>();
  public steps: RecordedStep[] = [];

  constructor(private headless: boolean) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.on("console", (m) => this.consoleLog.push(`[${m.type()}] ${m.text()}`));
    this.page.on("pageerror", (e) => this.consoleLog.push(`[pageerror] ${e.message}`));
    return this.page;
  }

  private resolve(ref?: string, selector?: string): string {
    if (selector) return selector;
    if (ref && this.refMap.has(ref)) return this.refMap.get(ref)!;
    throw new Error("Provide a 'selector' or a 'ref' from the latest browser_snapshot.");
  }

  async navigate(url: string): Promise<string> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    this.steps.push({ action: "navigate", url });
    return `Navigated to ${page.url()} — call browser_snapshot to see interactive elements.`;
  }

  async snapshot(): Promise<string> {
    const page = await this.ensurePage();
    const raw = (await page.evaluate(() => {
      const sel = "a, button, input, select, textarea, [role=button], [data-test]";
      const seen = new Set<Element>();
      const out: unknown[] = [];
      document.querySelectorAll(sel).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        out.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type"),
          role: el.getAttribute("role"),
          dataTest: el.getAttribute("data-test"),
          id: el.id || null,
          name: el.getAttribute("name"),
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
          placeholder: el.getAttribute("placeholder"),
        });
      });
      return out;
    })) as RawEl[];

    this.refMap.clear();
    const lines = raw.map((el, i) => {
      const ref = `e${i + 1}`;
      const selector = selectorFor(el);
      this.refMap.set(ref, selector);
      return `  ${ref}  ${describe(el)}  ->  ${selector}`;
    });
    return `URL: ${page.url()}\nTitle: ${await page.title()}\nInteractive elements (use ref or selector to act):\n${lines.join("\n")}`;
  }

  async click(ref?: string, selector?: string): Promise<string> {
    const page = await this.ensurePage();
    const sel = this.resolve(ref, selector);
    await page.locator(sel).first().click();
    this.steps.push({ action: "click", target: sel });
    return `Clicked ${sel}`;
  }

  async type(ref: string | undefined, selector: string | undefined, text: string, submit?: boolean): Promise<string> {
    const page = await this.ensurePage();
    const sel = this.resolve(ref, selector);
    await page.locator(sel).first().fill(text);
    if (submit) await page.locator(sel).first().press("Enter");
    this.steps.push({ action: "type", target: sel, value: text });
    return `Typed into ${sel}${submit ? " and pressed Enter" : ""}`;
  }

  async selectOption(ref: string | undefined, selector: string | undefined, value: string): Promise<string> {
    const page = await this.ensurePage();
    const sel = this.resolve(ref, selector);
    await page.locator(sel).first().selectOption(value);
    this.steps.push({ action: "select", target: sel, value });
    return `Selected "${value}" in ${sel}`;
  }

  async pressKey(key: string): Promise<string> {
    const page = await this.ensurePage();
    await page.keyboard.press(key);
    this.steps.push({ action: "press", value: key });
    return `Pressed ${key}`;
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.ensurePage();
    return page.screenshot({ type: "png" });
  }

  consoleMessages(): string {
    return this.consoleLog.length ? this.consoleLog.join("\n") : "(no console messages)";
  }

  async close(): Promise<string> {
    await this.browser?.close();
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.refMap.clear();
    return "Browser closed.";
  }
}
