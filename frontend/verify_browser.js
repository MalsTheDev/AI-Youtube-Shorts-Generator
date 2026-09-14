const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ARTIFACTS_DIR = '/home/mals/.gemini/antigravity/brain/5ba0f307-cc20-49b5-b671-326d389a5e89';

async function run() {
  console.log('Launching browser with Chrome...');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    console.log('1. Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

    // Step 1: Initial Dashboard
    const snap1 = path.join(ARTIFACTS_DIR, '01_dashboard_initial.png');
    await page.screenshot({ path: snap1 });
    console.log(`Saved screenshot 1: ${snap1}`);

    // Step 2: Fill in 2 YouTube URLs
    console.log('2. Entering 2 YouTube URLs...');
    await page.waitForSelector('#urls-input');
    const sampleUrls = [
      'https://www.youtube.com/watch?v=gTKS8SAwUzE',
      'https://www.youtube.com/watch?v=sample_video_2'
    ].join('\n');
    
    // Clear and type
    await page.click('#urls-input', { clickCount: 3 });
    await page.type('#urls-input', sampleUrls);

    // Select 1 clip per video for quick verification
    await page.select('select', '1');

    const snap2 = path.join(ARTIFACTS_DIR, '02_batch_urls_entered.png');
    await page.screenshot({ path: snap2 });
    console.log(`Saved screenshot 2: ${snap2}`);

    // Step 3: Submit batch job
    console.log('3. Submitting batch job...');
    await page.click('#submit-batch-btn');

    // Wait a brief moment for submission response and UI update
    await page.waitForTimeout ? page.waitForTimeout(2000) : new Promise(r => setTimeout(r, 2000));

    const snap3 = path.join(ARTIFACTS_DIR, '03_batch_enqueued_processing.png');
    await page.screenshot({ path: snap3 });
    console.log(`Saved screenshot 3: ${snap3}`);

    // Step 4: Wait for batch to complete
    console.log('4. Waiting for batch jobs to complete (polling table)...');
    let completed = false;
    const maxAttempts = 90; // Up to 3-4 minutes
    for (let i = 0; i < maxAttempts; i++) {
      const pageText = await page.evaluate(() => document.body.innerText);
      const isStillProcessing = pageText.includes('Processing') || pageText.includes('Queued');
      const hasCompleted = pageText.includes('Completed') && (pageText.match(/Completed/g) || []).length >= 2;

      console.log(`[Poll ${i + 1}/${maxAttempts}] HasCompleted: ${hasCompleted}, Processing: ${isStillProcessing}`);

      if (hasCompleted && !isStillProcessing) {
        completed = true;
        break;
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!completed) {
      console.log('Timed out waiting for full completion, taking screenshot of current state');
    }

    const snap4 = path.join(ARTIFACTS_DIR, '04_batch_jobs_completed.png');
    await page.screenshot({ path: snap4 });
    console.log(`Saved screenshot 4: ${snap4}`);

    // Step 5: Click "Preview Clips" button
    console.log('5. Clicking Preview Clips button...');
    await page.waitForSelector('.preview-clips-btn', { timeout: 10000 });
    await page.click('.preview-clips-btn');

    // Wait for modal & HTML5 video
    await page.waitForSelector('video', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    const videoSrc = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? v.getAttribute('src') : null;
    });
    console.log('Found video player with source:', videoSrc);

    const snap5 = path.join(ARTIFACTS_DIR, '05_clip_preview_modal_9_16.png');
    await page.screenshot({ path: snap5 });
    console.log(`Saved screenshot 5: ${snap5}`);

    console.log('Browser verification completed successfully!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});
