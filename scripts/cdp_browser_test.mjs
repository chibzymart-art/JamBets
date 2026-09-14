import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\9855693d-6a67-4eeb-8059-9abbbb6d9a81';
const PORT = 9222;

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
    if (!WebSocket) {
      // Fallback: Node 22+ has global WebSocket!
    }
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
    console.log(`📸 Screenshot saved: ${fullPath} (${buffer.length} bytes)`);
    return fullPath;
  }
}

async function run() {
  console.log('🚀 Launching Chrome in Headless Mode with remote debugging on port 9222...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,1100',
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
    console.log(`Connected to page: ${pageTarget.title} (${pageTarget.webSocketDebuggerUrl})`);

    const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    // Enable Page & Runtime
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    console.log('⏳ Waiting for dashboard rendering & market feed load...');
    await sleep(3500);

    // 1. Initial State: Curated Top Edge
    const initialTitle = await client.evaluate(`
      document.querySelector('.switchboard-main-title')?.textContent || 'Not found'
    `);
    console.log(`✓ Switchboard title: ${initialTitle}`);

    const cardCount = await client.evaluate(`
      document.querySelectorAll('.specialist-market-card').length
    `);
    const paginationInfo = await client.evaluate(`
      document.querySelector('.pagination-range-info')?.textContent?.trim() || 'No pagination'
    `);
    console.log(`✓ Pagination text: ${paginationInfo}`);

    // Scroll to market terminal to see cards clearly
    await client.evaluate(`
      const term = document.getElementById('market-terminal-stream-top');
      if (term) term.scrollIntoView({ block: 'start' });
    `);
    await sleep(800);

    await client.captureScreenshot('phase4_curated_market_terminal.png');

    // 2. Click 'Home Win' tab
    console.log('👉 Clicking Home Win Specialist tab...');
    await client.evaluate(`
      const tabs = Array.from(document.querySelectorAll('.market-switchboard-pill'));
      const hwTab = tabs.find(t => t.textContent.includes('Home Win'));
      if (hwTab) hwTab.click();
    `);
    await sleep(2000);

    const hwSubtitle = await client.evaluate(`
      document.querySelector('.switchboard-subtitle')?.textContent?.trim() || ''
    `);
    console.log(`✓ Home Win active subtitle: ${hwSubtitle}`);
    await client.captureScreenshot('phase4_home_win_market.png');

    // 3. Click 'Draw Hunter' tab
    console.log('👉 Clicking Draw Hunter tab...');
    await client.evaluate(`
      const tabs = Array.from(document.querySelectorAll('.market-switchboard-pill'));
      const drTab = tabs.find(t => t.textContent.includes('Draw Hunter'));
      if (drTab) drTab.click();
    `);
    await sleep(2000);

    const drSubtitle = await client.evaluate(`
      document.querySelector('.switchboard-subtitle')?.textContent?.trim() || ''
    `);
    console.log(`✓ Draw Hunter active subtitle: ${drSubtitle}`);
    await client.captureScreenshot('phase4_draw_hunter_market.png');

    // 4. Click 'Corners Specialist' tab
    console.log('👉 Clicking Corners Specialist tab...');
    await client.evaluate(`
      const tabs = Array.from(document.querySelectorAll('.market-switchboard-pill'));
      const crTab = tabs.find(t => t.textContent.includes('Corners'));
      if (crTab) crTab.click();
    `);
    await sleep(2000);
    await client.captureScreenshot('phase4_corners_market.png');

    // 5. Test 1-Click 3-Fold Acca Builder
    console.log('👉 Testing Quick Acca Builder...');
    await client.evaluate(`
      const btn = document.querySelector('.quick-acca-builder-btn');
      if (btn) btn.click();
    `);
    await sleep(1500);

    const drawerOpen = await client.evaluate(`
      document.querySelector('.favorites-drawer')?.classList.contains('open') || false
    `);
    const savedCount = await client.evaluate(`
      document.querySelector('.watchlist-count-badge')?.textContent || '0'
    `);
    console.log(`✓ Acca Drawer Open: ${drawerOpen}, Saved Items: ${savedCount}`);
    await client.captureScreenshot('phase4_acca_slip_drawer.png');

    console.log('🎉 ALL BROWSER INTERACTIONS & SCREENSHOT AUDITS COMPLETE!');
  } finally {
    chromeProcess.kill();
  }
}

run().catch((err) => {
  console.error('Error running CDP test:', err);
  process.exit(1);
});
