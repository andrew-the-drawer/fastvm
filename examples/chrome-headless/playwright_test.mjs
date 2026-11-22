// Smoke-test the headless Chrome sandbox over CDP.
import { chromium } from "playwright";

const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9222";

const browser = await chromium.connectOverCDP(cdpUrl);
const context = await browser.newContext();
const page = await context.newPage();

await page.setContent(`
  <html>
    <head><title>fastvm chrome</title></head>
    <body><h1>headless Chrome is working</h1></body>
  </html>
`);

const title = await page.title();
const heading = await page.locator("h1").innerText();

console.log(`title:   ${title}`);
console.log(`heading: ${heading}`);

await context.close();
await browser.close();

if (title !== "fastvm chrome" || heading !== "headless Chrome is working") {
  console.error("unexpected page content");
  process.exit(1);
}
