const puppeteer = require('puppeteer');
const path = require('path');

const ARTIFACTS_DIR = '/home/mals/.gemini/antigravity/brain/5ba0f307-cc20-49b5-b671-326d389a5e89';

async function test() {
  console.log('Launching Chrome to test video playback and modal close behavior...');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));

    console.log('Opening clip preview modal...');
    await page.waitForSelector('.preview-clips-btn');
    await page.click('.preview-clips-btn');

    // Wait for video element
    await page.waitForSelector('video');
    console.log('Video element found. Waiting 3 seconds for video to play frames...');
    await new Promise(r => setTimeout(r, 3000));

    // Capture screenshot of playing video modal
    const videoModalSnap = path.join(ARTIFACTS_DIR, '06_video_playing_fixed.png');
    await page.screenshot({ path: videoModalSnap });
    console.log(`Saved screenshot 6 (Video playing): ${videoModalSnap}`);

    // Now test clicking the 'X' button
    console.log('Clicking the X close button...');
    const xButton = await page.$('button[aria-label="Close modal"]');
    if (!xButton) throw new Error('Close modal button not found!');
    await xButton.click();

    // Wait 2 seconds and check if modal is closed
    await new Promise(r => setTimeout(r, 2000));
    const modalStillExists = await page.$('video');
    console.log('Modal still exists after clicking X?', modalStillExists !== null);

    if (modalStillExists !== null) {
      throw new Error('FAIL: Modal did not close when clicking X!');
    }
    console.log('SUCCESS: Modal closed cleanly when clicking X!');

    // Capture screenshot after close
    const closedSnap = path.join(ARTIFACTS_DIR, '07_modal_closed.png');
    await page.screenshot({ path: closedSnap });
    console.log(`Saved screenshot 7 (Modal closed): ${closedSnap}`);

  } finally {
    await browser.close();
  }
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
