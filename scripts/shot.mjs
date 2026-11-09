import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [, , url = "http://localhost:1420", out = "shots/now-playing.png", seek] = process.argv;
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3600);
if (seek) {
  await page.getByLabel("Play").first().click();
  await page.waitForTimeout(Number(seek));
} else {
  await page.getByLabel(/^Play/).last().click();
  await page.waitForTimeout(2600);
}
await page.screenshot({ path: out });
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
