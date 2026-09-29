import { connectCdp, solveSliderCaptcha } from "./captcha-solver";

async function main() {
  const { browser, page } = await connectCdp();
  console.log("connected, page:", await page.url());
  await page.goto("https://chat.z.ai/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // fill composer
  const ta = page.locator("textarea").first();
  await ta.fill("Reply with exactly: PING-OK");
  await page.waitForTimeout(600);

  // click send
  const sendBtn = page
    .locator('button[aria-label*="Send" i], button:has-text("Send")')
    .first();
  await sendBtn.click();
  await page.waitForTimeout(1600);

  const captchaVisible = await page.evaluate(
    () => !!document.querySelector(".window-show"),
  );
  console.log("captcha visible:", captchaVisible);

  if (captchaVisible) {
    const res = await solveSliderCaptcha(page);
    console.log("solver:", JSON.stringify(res));
  }

  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log("PAGE:", text.replace(/\n/g, " | "));
  const completions = [];
  browser.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
