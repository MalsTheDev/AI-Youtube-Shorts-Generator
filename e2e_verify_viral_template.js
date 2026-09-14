const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = '/home/mals/.gemini/antigravity/brain/5ba0f307-cc20-49b5-b671-326d389a5e89';

async function run() {
  console.log('Starting E2E verification of Viral Ranking Template & Blur Modes...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1100'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err.message));

  try {
    // 1. Visit Queue Page
    console.log('Navigating to /queue ...');
    await page.goto('http://localhost:3000/queue', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    const queueScreenshot = path.join(ARTIFACT_DIR, '01_queue_layout_options.png');
    await page.screenshot({ path: queueScreenshot, fullPage: true });
    console.log(`Saved screenshot: ${queueScreenshot}`);

    // 2. Navigate to Review Studio
    console.log('Navigating to Review Studio: http://localhost:3000/review/job_b4c9a062 ...');
    await page.goto('http://localhost:3000/review/job_b4c9a062', { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForSelector('[id^="candidate-card-"]', { timeout: 20000 });
    console.log('Candidate cards loaded successfully!');

    await new Promise(r => setTimeout(r, 2000));

    const studioScreenshot = path.join(ARTIFACT_DIR, '02_review_viral_studio.png');
    await page.screenshot({ path: studioScreenshot, fullPage: false });
    console.log(`Saved screenshot: ${studioScreenshot}`);

    // 3. Trigger 1:1 Render
    console.log('Triggering Render with 1:1 Square (Blurred BG)...');
    const renderBtn = await page.$('#render-export-btn');
    if (!renderBtn) throw new Error('#render-export-btn not found');
    await renderBtn.click();

    console.log('Waiting for render completion...');
    await page.waitForFunction(
      () => document.body.innerText.includes('Ranking Short compiled successfully'),
      { timeout: 180000 }
    );
    console.log('1:1 Render succeeded!');

    // Wait 3 seconds for video player to reload and play
    await new Promise(r => setTimeout(r, 3000));

    // Check video player
    const videoStats = await page.evaluate(() => {
      const video = document.querySelector('#review-player-video');
      if (!video) return null;
      video.muted = true;
      video.currentTime = 4.0;
      video.play();
      return {
        src: video.src,
        duration: video.duration,
        currentTime: video.currentTime,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };
    });
    console.log('Video stats (1:1 Mode):', JSON.stringify(videoStats, null, 2));

    await new Promise(r => setTimeout(r, 2000));

    const playingScreenshot1 = path.join(ARTIFACT_DIR, '03_viral_video_playing_1_1.png');
    await page.screenshot({ path: playingScreenshot1, fullPage: false });
    console.log(`Saved screenshot: ${playingScreenshot1}`);

    // 4. Test Switching to 16:9 Mode
    console.log('Switching to 16:9 Full Ratio Mode...');
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await (await btn.getProperty('innerText')).jsonValue();
      if (text.includes('16:9 Full Ratio')) {
        await btn.click();
        console.log('Clicked 16:9 Full Ratio button');
        break;
      }
    }

    await new Promise(r => setTimeout(r, 1000));

    // Render 16:9
    console.log('Triggering Render with 16:9 Full Ratio (Blurred BG)...');
    await renderBtn.click();

    console.log('Waiting for 16:9 render completion...');
    // Reset or wait for success
    await new Promise(r => setTimeout(r, 4000));
    await page.waitForFunction(
      () => document.body.innerText.includes('Ranking Short compiled successfully'),
      { timeout: 180000 }
    );
    console.log('16:9 Render succeeded!');

    await new Promise(r => setTimeout(r, 3000));

    await page.evaluate(() => {
      const video = document.querySelector('#review-player-video');
      if (video) {
        video.muted = true;
        video.currentTime = 4.0;
        video.play();
      }
    });

    await new Promise(r => setTimeout(r, 2000));

    const playingScreenshot2 = path.join(ARTIFACT_DIR, '04_viral_video_playing_16_9.png');
    await page.screenshot({ path: playingScreenshot2, fullPage: false });
    console.log(`Saved screenshot: ${playingScreenshot2}`);

    console.log('All verification checks completed successfully!');
  } catch (err) {
    console.error('Test execution failed:', err);
    const errScreenshot = path.join(ARTIFACT_DIR, 'error_verification_viral.png');
    await page.screenshot({ path: errScreenshot, fullPage: true }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
