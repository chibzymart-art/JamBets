import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\b2db48ac-78f1-40f0-95ae-728316faf141';
const PORT = 9227;

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
    const WS = globalThis.WebSocket;
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
    console.log(`📸 Screenshot saved: ${fullPath} (${buffer.length} bytes)`);
    return fullPath;
  }
}

async function run() {
  console.log('🚀 Launching Chrome to inspect unclipped words on http://localhost:5173/tennis ...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1400,1200',
      'http://localhost:5173/tennis',
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

    console.log('⏳ Waiting for tennis feed to load...');
    await sleep(4000);

    // Click 'Today' tab
    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('.tennis-date-tab, button'));
        const target = tabs.find(t => t.textContent.includes('Today')) || tabs[0];
        if (target) target.click();
      })()
    `);
    await sleep(2000);

    // Expand the first 5 cards
    await client.evaluate(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.fixture-card.glance-fixture-box'));
        cards.slice(0, 5).forEach(card => card.click());
      })()
    `);
    await sleep(2000);

    // Measure text clipping and full visibility
    const textAudit = await client.evaluate(`
      (() => {
        const tiles = Array.from(document.querySelectorAll('.tennis-secondary-pred-tile'));
        let totalTiles = tiles.length;
        let anyEllipsis = false;
        let anyOverflow = false;
        const details = [];

        tiles.slice(0, 12).forEach((tile, idx) => {
          const titleEl = tile.querySelector('span');
          const pickEl = tile.querySelector('div[style*="font-size: 14"]');
          const probEl = tile.querySelector('span[style*="font-size: 12.5"]');

          const pickStyle = pickEl ? window.getComputedStyle(pickEl) : null;
          const isEllipsis = pickStyle ? pickStyle.textOverflow === 'ellipsis' : false;
          const isNowrap = pickStyle ? pickStyle.whiteSpace === 'nowrap' : false;
          const isClipped = pickEl ? (pickEl.scrollWidth > pickEl.clientWidth + 2) : false;

          if (isEllipsis) anyEllipsis = true;
          if (isClipped) anyOverflow = true;

          details.push({
            index: idx,
            marketTitle: titleEl?.textContent?.trim(),
            fullPickText: pickEl?.textContent?.trim(),
            probText: probEl?.textContent?.trim(),
            computedWhiteSpace: pickStyle?.whiteSpace,
            computedTextOverflow: pickStyle?.textOverflow,
            scrollWidth: pickEl?.scrollWidth,
            clientWidth: pickEl?.clientWidth,
            isVisuallyClipped: isClipped
          });
        });

        return {
          totalTiles,
          anyEllipsis,
          anyOverflow,
          tilesSample: details
        };
      })()
    `);

    console.log('\n================================================================================');
    console.log(' SECONDARY PREDICTION FULL-TEXT AUDIT RESULTS');
    console.log('================================================================================');
    console.log(`Total Secondary Tiles Found: ${textAudit.totalTiles}`);
    console.log(`Any CSS Ellipsis Truncation: ${textAudit.anyEllipsis ? '❌ YES (FAIL)' : '✅ NONE (PASS)'}`);
    console.log(`Any Horizontal Text Clipping (scrollWidth > clientWidth): ${textAudit.anyOverflow ? '❌ YES (FAIL)' : '✅ NONE (PASS)'}`);
    console.log('\nSample Tiles Inspected:');
    console.log(JSON.stringify(textAudit.tilesSample, null, 2));

    await client.captureScreenshot('tennis_ui_unclipped_words.png');
    console.log('\n✅ Verification Complete.');
  } finally {
    try {
      chromeProcess.kill();
    } catch {}
  }
}

run().catch((err) => {
  console.error('Error during full-text audit:', err);
  process.exit(1);
});
