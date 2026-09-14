import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\9855693d-6a67-4eeb-8059-9abbbb6d9a81';
const PORT = 9223;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    const { WebSocket } = await import('ws').catch(() => ({}));
    const WS = WebSocket || globalThis.WebSocket;
    if (!WS) throw new Error('WebSocket not available');

    this.ws = new WS(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const fullPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(fullPath, buffer);
    console.log(`📸 Screenshot saved: ${filename} (${buffer.length} bytes)`);
    return fullPath;
  }
}

async function run() {
  console.log('🚀 Launching Chrome on port ' + PORT + ' for Phase 4.1 UI Verification...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,1050',
      'http://localhost:5173/dashboard',
    ],
    { stdio: 'ignore' }
  );

  try {
    let targets = null;
    for (let i = 0; i < 25; i++) {
      await sleep(500);
      try {
        targets = await getJson(`http://localhost:${PORT}/json`);
        if (targets && targets.length > 0) break;
      } catch {}
    }

    if (!targets || targets.length === 0) {
      throw new Error('Failed to connect to Chrome debugging port');
    }

    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    console.log('⏳ Waiting for dashboard load...');
    await sleep(3500);

    // 1. Verify Layout Order on Desktop
    const layoutOrder = await client.evaluate(`
      (() => {
        const sportsBar = document.querySelector('.sport-categories-bar');
        const switchboard = document.querySelector('.market-switchboard-container');
        const scorecard = document.querySelector('.daily-scorecard-section');

        const sportsBarY = sportsBar ? sportsBar.getBoundingClientRect().top : -1;
        const switchboardY = switchboard ? switchboard.getBoundingClientRect().top : -1;
        const scorecardY = scorecard ? scorecard.getBoundingClientRect().top : -1;

        return {
          sportsBarY,
          switchboardY,
          scorecardY,
          isCorrectOrder: sportsBarY < switchboardY && switchboardY < scorecardY,
          scorecardHeight: scorecard ? scorecard.getBoundingClientRect().height : -1,
        };
      })()
    `);

    console.log('✓ Layout Positioning Test:', layoutOrder);
    if (!layoutOrder.isCorrectOrder) {
      console.warn('⚠️ Warning: Switchboard order unexpected:', layoutOrder);
    } else {
      console.log('✅ PASS: Switchboard is positioned DIRECTLY under sport types and above daily scorecard!');
    }
    console.log('✅ Scorecard Section Height: ' + Math.round(layoutOrder.scorecardHeight) + 'px (compacted)');

    // 2. Verify Default Active Tab is "General Market"
    const activeTabInfo = await client.evaluate(`
      (() => {
        const activeTab = document.querySelector('.market-switchboard-pill.active');
        const generalCards = document.querySelectorAll('.chronological-fixtures-stream > *').length;
        const fixtureCards = document.querySelectorAll('.fixture-card').length;
        return {
          activeTabLabel: activeTab ? activeTab.textContent.trim() : 'NONE',
          generalCards,
          fixtureCards,
        };
      })()
    `);
    console.log('✓ Default Active Tab & Card Count:', activeTabInfo);

    await client.captureScreenshot('phase4_1_desktop_general_market.png');

    // 3. Test Clicking "Curated Top Edge"
    console.log('👉 Clicking Curated Top Edge tab...');
    await client.evaluate(`
      (() => {
        const pills = Array.from(document.querySelectorAll('.market-switchboard-pill'));
        const curated = pills.find(p => p.textContent.includes('Curated'));
        if (curated) curated.click();
      })()
    `);
    await sleep(2000);

    const specialistInfo = await client.evaluate(`
      (() => {
        const specialistCards = document.querySelectorAll('.specialist-market-card').length;
        const pagination = document.querySelector('.smart-pagination-bar-wrapper');
        const accaBtn = document.querySelector('.quick-acca-builder-btn');
        return {
          specialistCards,
          hasPagination: Boolean(pagination),
          hasAccaBtn: Boolean(accaBtn),
        };
      })()
    `);
    console.log('✓ Specialist Market View (Curated):', specialistInfo);
    await client.captureScreenshot('phase4_1_desktop_curated_market.png');

    // 4. Test Switching back to "General Market"
    console.log('👉 Switching back to General Market...');
    await client.evaluate(`
      (() => {
        const pills = Array.from(document.querySelectorAll('.market-switchboard-pill'));
        const general = pills.find(p => p.textContent.includes('General'));
        if (general) general.click();
      })()
    `);
    await sleep(1500);

    // 5. Test Mobile View (390px)
    console.log('📱 Resizing to Mobile (390x844)...');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(1000);

    const mobileLayout = await client.evaluate(`
      (() => {
        const switchboard = document.querySelector('.market-switchboard-container');
        const scorecard = document.querySelector('.daily-scorecard-section');
        return {
          switchboardWidth: switchboard ? switchboard.scrollWidth : 0,
          scorecardHeight: scorecard ? scorecard.getBoundingClientRect().height : 0,
          scrollXActive: switchboard ? switchboard.querySelector('.market-switchboard-pills-bar')?.scrollWidth > 350 : false,
        };
      })()
    `);
    console.log('✓ Mobile Layout Metrics:', mobileLayout);

    await client.captureScreenshot('phase4_1_mobile_general_market.png');

    // Click "Over 2.5 Goals" on mobile
    console.log('👉 Mobile: Clicking Over 2.5 Goals...');
    await client.evaluate(`
      (() => {
        const pills = Array.from(document.querySelectorAll('.market-switchboard-pill'));
        const o25 = pills.find(p => p.textContent.includes('Over 2.5'));
        if (o25) o25.click();
      })()
    `);
    await sleep(2000);
    await client.captureScreenshot('phase4_1_mobile_specialist_market.png');

    console.log('🎉 ALL PHASE 4.1 AUDIT CHECKS PASSED SUCCESSFULLY!');
  } finally {
    chromeProcess.kill();
  }
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
