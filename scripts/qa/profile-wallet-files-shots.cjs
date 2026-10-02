const { chromium } = require('playwright');
const path = require('path');
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
 for (const size of [{name:'desktop',width:1440,height:1050},{name:'mobile',width:390,height:844}]) {
  const page = await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1});
  for (const state of ['populated','empty','error']) {
   await page.goto(`http://localhost:3100/profile-preview-local?state=${state}`,{waitUntil:'networkidle'});
   await page.evaluate(() => document.fonts.ready); await page.screenshot({path:`${process.env.SHOT_DIR || '/downloads'}/dinghy-profile-${size.name}-${state}.png`,fullPage:true});
   console.log(size.name,state,await page.locator('body').evaluate(e => ({width:e.scrollWidth,viewport:innerWidth})));
  }
  await page.close();
 }
 await browser.close();
})();
