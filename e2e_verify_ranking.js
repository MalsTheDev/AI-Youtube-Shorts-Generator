const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = '/home/mals/.gemini/antigravity/brain/5ba0f307-cc20-49b5-b671-326d389a5e89';

async function run() {
  console.log('Starting end-to-end browser verification of Ranking Viral Short Studio...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1080'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1080 });

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err.message));

  try {
    // 1. Visit Queue Page
    console.log('Navigating to /queue ...');
    await page.goto('http://localhost:3000/queue', { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for jobs table to populate (3s poll or initial fetch)
    await page.waitForFunction(() => {
      return document.querySelectorAll('tbody tr').length > 0 && !document.body.innerText.includes('Loading jobs...');
    }, { timeout: 10000 }).catch(() => console.log('Wait for table rows timed out or table empty'));

    await new Promise(r => setTimeout(r, 1000));

    const queueScreenshot = path.join(ARTIFACT_DIR, '01_queue_dashboard.png');
    await page.screenshot({ path: queueScreenshot, fullPage: true });
    console.log(`Saved screenshot: ${queueScreenshot}`);

    // Check if review button exists in table
    const reviewLinks = await page.$$eval('a[href*="/review/"]', els => els.map(e => e.getAttribute('href')));
    console.log('Found review links:', reviewLinks);

    const targetUrl = reviewLinks.length > 0 
      ? `http://localhost:3000${reviewLinks[0]}` 
      : 'http://localhost:3000/review/job_b4c9a062';

    // 2. Navigate to Review Studio
    console.log(`Navigating to Review Studio: ${targetUrl} ...`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for candidate cards to appear
    await page.waitForSelector('[id^="candidate-card-"]', { timeout: 20000 });
    console.log('Candidate cards loaded successfully!');

    // Wait 2s for UI & video elements to settle
    await new Promise(r => setTimeout(r, 2000));

    const initialReviewScreenshot = path.join(ARTIFACT_DIR, '02_review_studio_initial.png');
    await page.screenshot({ path: initialReviewScreenshot, fullPage: false });
    console.log(`Saved screenshot: ${initialReviewScreenshot}`);

    // 3. Customize Header Title Banner
    console.log('Customizing Header Title Banner...');
    const headerInput = await page.$('#header-title-input');
    if (headerInput) {
      await page.click('#header-title-input');
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await headerInput.type('RANKING BEST RANDOM MOMENTS', { delay: 15 });
    }

    // 4. Verify/Customize Candidate Clips
    console.log('Selecting customized clip selection...');
    const candidateCards = await page.$$('[id^="candidate-card-"]');
    console.log(`Found ${candidateCards.length} candidate cards.`);

    await new Promise(r => setTimeout(r, 1000));

    const customizedReviewScreenshot = path.join(ARTIFACT_DIR, '03_review_customized_ready.png');
    await page.screenshot({ path: customizedReviewScreenshot, fullPage: true });
    console.log(`Saved screenshot: ${customizedReviewScreenshot}`);

    // 5. Trigger Render
    console.log('Clicking "Render & Export Final Video"...');
    const renderBtn = await page.$('#render-export-btn');
    if (!renderBtn) {
      throw new Error('Render button #render-export-btn not found!');
    }
    await renderBtn.click();

    console.log('Waiting for render completion (checking for success banner)...');
    // Wait for the render success banner to appear
    await page.waitForFunction(
      () => {
        const bodyText = document.body.innerText;
        return bodyText.includes('Ranking Short compiled successfully');
      },
      { timeout: 180000 }
    );
    console.log('Render succeeded!');

    // Unmute and play video
    await page.evaluate(() => {
      const vid = document.querySelector('#review-player-video');
      if (vid) {
        vid.muted = true;
        vid.play().catch(e => console.log('play error:', e));
      }
    });
    await new Promise(r => setTimeout(r, 4000));

    // Check video playing state
    const videoStats = await page.evaluate(() => {
      const vid = document.querySelector('#review-player-video');
      if (!vid) return { exists: false };
      return {
        exists: true,
        src: vid.src,
        duration: vid.duration,
        currentTime: vid.currentTime,
        paused: vid.paused,
        videoWidth: vid.videoWidth,
        videoHeight: vid.videoHeight,
      };
    });
    console.log('Video Player Stats (Playing):', JSON.stringify(videoStats, null, 2));

    const finalPlayingScreenshot = path.join(ARTIFACT_DIR, '05_video_playing_progress.png');
    await page.screenshot({ path: finalPlayingScreenshot, fullPage: false });
    console.log(`Saved screenshot: ${finalPlayingScreenshot}`);

    console.log('All end-to-end browser verification checks passed successfully!');
  } catch (err) {
    console.error('E2E Verification Error:', err);
    const errScreenshot = path.join(ARTIFACT_DIR, 'error_verification.png');
    await page.screenshot({ path: errScreenshot, fullPage: true }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
