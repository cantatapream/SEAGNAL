const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: { width: 1080, height: 1080 } // Square viewport for icon generation
    });
    const page = await browser.newPage();

    // Navigate to local server
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });

    // Override CSS to make background transparent and center content for icon
    await page.addStyleTag({
        content: `
            .splash-screen { background: transparent !important; }
            body { background: transparent !important; }
            /* Hide the background rings for the static icon if they look messy */
             .splash-logo-container::before, .splash-logo-container::after { opacity: 0 !important; }
        `
    });

    // Wait for the splash animation to finish (approx 3 seconds)
    await new Promise(r => setTimeout(r, 2800));

    // Get the splash content element
    const element = await page.$('.splash-content');

    // Capture just the content area, but we want a square image with padding
    // so it fits in the Android circular splash mask.
    // We'll capture the specific element with a transparent background.

    if (element) {
        // Take screenshot of the element
        await element.screenshot({
            path: 'images/splash_logo_text.png',
            omitBackground: true
        });
        console.log('Splash content captured.');
    } else {
        console.error('Splash content not found');
    }

    await browser.close();
})();
