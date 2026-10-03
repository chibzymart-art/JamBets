import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\b2db48ac-78f1-40f0-95ae-728316faf141';
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
  console.log('🚀 Launching Chrome to inspect http://localhost:5173/tennis ...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,1200',
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
    console.log(`Connected to page: ${pageTarget.title} (${pageTarget.webSocketDebuggerUrl})`);

    const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    console.log('⏳ Waiting for tennis feed to load...');
    await sleep(4000);

    // Get title & KPIs
    const pageHeader = await client.evaluate(`
      document.querySelector('h1')?.textContent || document.title
    `);
    console.log(`Page Header: ${pageHeader}`);

    const kpiSummary = await client.evaluate(`
      Array.from(document.querySelectorAll('.tennis-winrates-kpi-card .compact-kpi-segment')).map(el => {
        return {
          title: el.querySelector('.compact-kpi-title')?.textContent?.trim(),
          pct: el.querySelector('.compact-kpi-pct')?.textContent?.trim(),
          ratio: el.querySelector('.compact-kpi-ratio')?.textContent?.trim()
        };
      })
    `);
    console.log('KPI Deck Segments:', JSON.stringify(kpiSummary, null, 2));

    // Check date tabs
    const dateTabs = await client.evaluate(`
      Array.from(document.querySelectorAll('.tennis-date-tab, button')).map(b => b.textContent?.trim()).filter(Boolean)
    `);
    console.log('Available tabs/buttons:', dateTabs);

    // Try clicking 'Today' or 'All Dates' tab in .tennis-date-ribbon
    const clickedTab = await client.evaluate(`
      const tabs = Array.from(document.querySelectorAll('.tennis-date-tab'));
      const target = tabs.find(t => t.textContent.includes('Today')) || tabs.find(t => t.textContent.includes('All Dates')) || tabs[0];
      if (target) {
        target.click();
        target.textContent.trim();
      } else {
        null;
      }
    `);
    console.log('Clicked date tab:', clickedTab);

    await sleep(2000);

    const cardCount = await client.evaluate(`
      document.querySelectorAll('.fixture-card.glance-fixture-box').length
    `);
    console.log(`Total Tennis Prediction Cards: ${cardCount}`);

    // Click the first card's expand bar
    const expanded = await client.evaluate(`
      const expandBtn = document.querySelector('.tennis-card-expand-bar') || document.querySelector('.glance-chevron-btn');
      if (expandBtn) {
        expandBtn.click();
        expandBtn.textContent.trim();
      } else {
        false;
      }
    `);
    console.log(`Expanded first card: ${expanded}`);

    await sleep(1500);

    // Extract first 3 cards details
    const cardsInfo = await client.evaluate(`
      (() => {
        try {
          const cards = Array.from(document.querySelectorAll('.fixture-card.glance-fixture-box')).slice(0, 3);
          return cards.map(card => {
            const tournament = card.querySelector('.glance-league-pill')?.textContent?.trim();
            const players = Array.from(card.querySelectorAll('.glance-team-name')).map(p => p.textContent.trim());
            const primaryPick = card.querySelector('.sniper-outcome-val')?.textContent?.trim() || card.querySelector('.key-pick-outcome')?.textContent?.trim();
            const primaryProb = card.querySelector('.sniper-prob-val')?.textContent?.trim();
            const tierBadge = card.querySelector('.sniper-banker-badge')?.textContent?.trim();

            const secSection = card.querySelector('.tennis-secondary-markets-section');
            const secondaryText = secSection ? secSection.innerText : 'No secondary section';

            return {
              tournament,
              players,
              primaryPick,
              primaryProb,
              tierBadge,
              secondaryText
            };
          });
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);
    console.log('Cards Info:', JSON.stringify(cardsInfo, null, 2));

    await client.captureScreenshot('tennis_ui_phase1_inspection.png');

    console.log('✅ UI inspection completed successfully.');
  } finally {
    try {
      chromeProcess.kill();
    } catch {}
  }
}

run().catch((err) => {
  console.error('Error during UI inspection:', err);
  process.exit(1);
});
