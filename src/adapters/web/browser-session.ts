import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface BrowserSessionOptions {
  headless?: boolean;
}

export class BrowserSession {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private readonly options: BrowserSessionOptions;

  public constructor(options: BrowserSessionOptions = {}) {
    this.options = options;
  }

  public async getPage(): Promise<Page> {
    if (!this.page) {
      this.browser = await chromium.launch({ headless: this.options.headless ?? true });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
    }

    return this.page;
  }

  public async close(): Promise<void> {
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;

    if (browser) {
      await browser.close();
    }
  }
}
