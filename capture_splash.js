const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: { width: 1080, height: 1920 } // Mobile view
    });
    const page = await browser.newPage();

    // Navigate to local server
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });

    // Wait for the splash animation to finish (approx 2-3 seconds)
    // The logo scales up and text fades in.
    await new Promise(r => setTimeout(r, 2500));

    // Capture the screenshot
    await page.screenshot({ path: 'images/splash_full_capture.png' });

    await browser.close();
    console.log('Splash screen captured to images/splash_full_capture.png');
})();
