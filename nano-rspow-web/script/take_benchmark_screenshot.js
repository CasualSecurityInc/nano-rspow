/**
 * Utility script to automate capturing a beautiful, high-quality, non-retina screenshot
 * of the interactive WebGPU/WASM benchmarking dashboard at "Receive" difficulty.
 * 
 * Usage:
 *   1. npm install playwright
 *   2. node take_benchmark_screenshot.js
 */

const { chromium } = require('playwright');
const path = require('path');

(async () => {
    console.log('Launching Chromium...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1024, height: 850 },
        deviceScaleFactor: 1 // Standard resolution (non-retina) to keep file size optimized
    });
    const page = await context.newPage();

    const htmlPath = 'file://' + path.resolve(__dirname, '../browser-demo/index.html');
    console.log(`Navigating to ${htmlPath}...`);
    await page.goto(htmlPath);

    // 1. Wait for page components to initialize
    console.log('Waiting for WebGPU initialization...');
    await page.waitForTimeout(2000);

    // 2. Click the threshold selector into "Receive" (which is index 1, bar-2)
    console.log('Clicking the Receive difficulty selector...');
    await page.click('.bar-2');
    await page.waitForTimeout(500);

    // 3. Click "Generate Work"
    console.log('Clicking Generate Work...');
    await page.click('#btn-run');

    // 4. Wait for PoW generation to finish (res-status transitions to "PoW Found!")
    console.log('Waiting for PoW generation to complete...');
    await page.waitForFunction(() => {
        const el = document.getElementById('res-status');
        return el && el.textContent.includes('PoW Found!');
    }, { timeout: 35000 });

    // Extra breathing room for the smooth scroll & transition to settle
    await page.waitForTimeout(1000);

    // Forcibly scroll all the way back up to the start of the page before taking the shot
    console.log('Scrolling back to the top of the page...');
    await page.evaluate(() => {
        window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);

    // 5. Take screenshot
    const outputPath = path.resolve(__dirname, '../../assets/benchmark-ui.png');
    console.log(`Capturing screenshot to ${outputPath}...`);
    await page.screenshot({ path: outputPath });

    await browser.close();
    console.log('Screenshot generation complete successfully!');
})();
