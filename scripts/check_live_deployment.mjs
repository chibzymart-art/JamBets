import http from 'http';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\8c0eee48-5099-492b-89c9-c2d1fa78c689';
const PORT = 9222;
const LIVE_BASE = 'https://jambets.vercel.app';

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

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('Checking live asset bundle on', LIVE_BASE);
  const res = await fetch(LIVE_BASE);
  const html = await res.text();
  const assets = html.match(/assets\/index-[^"']+/g) || [];
  console.log('Live deployed assets:', assets);

  console.log('Connecting to Chrome on port', PORT);
  const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
  const pageTarget = targets.find((t) => t.type === 'page');

  if (!pageTarget) {
    console.error('No suitable browser page target found.');
    process.exit(1);
  }

  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  const setViewport = async (width, height) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
  };

  const takeScreenshot = async (name) => {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filePath = path.join(ARTIFACT_DIR, `${name}.png`);
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    console.log('Saved screenshot:', filePath);
  };

  const evalJs = async (expr) => {
    const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return res.result?.value;
  };

  const waitForSelector = async (selector, timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await evalJs(`!!document.querySelector('${selector}')`);
      if (found) return true;
      await sleep(500);
    }
    return false;
  };

  await setViewport(1920, 957);

  // 1. TEST LIVE DASHBOARD / PREDICTIONS
  console.log('\n--- 1. Testing Live /dashboard on', LIVE_BASE, '---');
  await cdp.send('Page.navigate', { url: `${LIVE_BASE}/dashboard` });
  const hasGrid = await waitForSelector('.main-dashboard-grid', 20000);
  console.log('Live Dashboard Grid Loaded:', hasGrid);
  await sleep(2000);

  const dashboardInfo = await evalJs(`(() => {
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const leftAds = leftCol ? leftCol.querySelectorAll('.ad-sidebar-card').length : 0;
    const bangersCard = document.querySelector('.bangers-sidebar-card');
    const bangersText = document.body.innerText.includes('DAILY 90%+ BANGERS');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');
    const currentUrl = window.location.href;

    return {
      currentUrl,
      hasLeftCol: !!leftCol,
      leftAdsCount: leftAds,
      hasBangersCard: !!bangersCard,
      hasBangersText: bangersText,
      hasRightCol: !!rightCol,
      hasWatchlistCard: !!watchlistCard
    };
  })()`);
  console.log('Live Dashboard Info:', JSON.stringify(dashboardInfo, null, 2));
  await takeScreenshot('live_prod_dashboard_desktop');

  // Scroll 800px on live dashboard
  await evalJs(`window.scrollTo({ top: 800, behavior: 'instant' })`);
  await sleep(1000);
  await takeScreenshot('live_prod_dashboard_scroll_800');

  // 2. TEST LIVE OTHER MARKETS
  console.log('\n--- 2. Testing Live /other-markets on', LIVE_BASE, '---');
  await evalJs(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await cdp.send('Page.navigate', { url: `${LIVE_BASE}/other-markets` });
  await waitForSelector('.desktop-page-grid', 20000);
  await sleep(2000);

  const otherMarketsInfo = await evalJs(`(() => {
    const grid = document.querySelector('.desktop-page-grid');
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const leftAds = leftCol ? leftCol.querySelectorAll('.ad-sidebar-card').length : 0;
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');
    const currentUrl = window.location.href;

    return {
      currentUrl,
      hasGrid: !!grid,
      hasLeftCol: !!leftCol,
      leftAdsCount: leftAds,
      hasRightCol: !!rightCol,
      hasWatchlistCard: !!watchlistCard
    };
  })()`);
  console.log('Live Other Markets Info:', JSON.stringify(otherMarketsInfo, null, 2));
  await takeScreenshot('live_prod_other_markets_desktop');

  // 3. TEST LIVE SUBSCRIPTION
  console.log('\n--- 3. Testing Live /subscription on', LIVE_BASE, '---');
  await cdp.send('Page.navigate', { url: `${LIVE_BASE}/subscription` });
  await waitForSelector('.desktop-page-grid', 20000);
  await sleep(2000);

  const subscriptionInfo = await evalJs(`(() => {
    const grid = document.querySelector('.desktop-page-grid');
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const leftAds = leftCol ? leftCol.querySelectorAll('.ad-sidebar-card').length : 0;
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');

    return {
      hasGrid: !!grid,
      hasLeftCol: !!leftCol,
      leftAdsCount: leftAds,
      hasRightCol: !!rightCol,
      hasWatchlistCard: !!watchlistCard
    };
  })()`);
  console.log('Live Subscription Info:', JSON.stringify(subscriptionInfo, null, 2));
  await takeScreenshot('live_prod_subscription_desktop');

  // Reset viewport
  await setViewport(1920, 957);
  cdp.close();
  console.log('\nAll live production tests complete!');
}

run().catch((err) => {
  console.error('Error in live verification script:', err);
  process.exit(1);
});
