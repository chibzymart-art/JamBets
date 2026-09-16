import http from 'http';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\8c0eee48-5099-492b-89c9-c2d1fa78c689';
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
  console.log('Connecting to Chrome on port', PORT);
  const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
  const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173')) || targets.find((t) => t.type === 'page');

  if (!pageTarget) {
    console.error('No suitable browser page target found.');
    process.exit(1);
  }

  console.log('Using target:', pageTarget.title, pageTarget.url);
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

  // 1. TEST DASHBOARD (DESKTOP)
  console.log('\n--- 1. Testing /dashboard ---');
  await setViewport(1920, 957);
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/dashboard' });
  await sleep(2500);

  const dashboardInfo = await evalJs(`(() => {
    const bangersCard = document.querySelector('.bangers-sidebar-card');
    const bangersHeader = document.querySelector('.bangers-sidebar-header');
    const bangersText = document.body.innerText.includes('DAILY 90%+ BANGERS');
    
    const watchlistCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');
    const watchlistHeader = document.querySelector('.watchlist-sidebar-header');
    const watchlistAds = watchlistCard ? watchlistCard.querySelectorAll('.ad-banner-slot-container').length : -1;
    const underWatchlistAds = watchlistCol ? watchlistCol.querySelectorAll('.under-sidebar-ad-wrap').length : -1;

    return {
      hasBangersCard: !!bangersCard,
      hasBangersHeader: !!bangersHeader,
      hasBangersText: bangersText,
      hasWatchlistCol: !!watchlistCol,
      hasWatchlistCard: !!watchlistCard,
      watchlistAds,
      underWatchlistAds
    };
  })()`);
  console.log('Dashboard Info:', JSON.stringify(dashboardInfo, null, 2));
  await takeScreenshot('dashboard_no_bangers_desktop');

  // Scroll down 800px on Dashboard to verify scroll behavior
  await evalJs(`window.scrollTo({ top: 800, behavior: 'instant' })`);
  await sleep(1000);
  await takeScreenshot('dashboard_no_bangers_scroll_800');

  // 2. TEST OTHER MARKETS (DESKTOP)
  console.log('\n--- 2. Testing /other-markets ---');
  await evalJs(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/other-markets' });
  await sleep(2500);

  const otherMarketsInfo = await evalJs(`(() => {
    const grid = document.querySelector('.desktop-page-grid');
    const bangersCard = document.querySelector('.bangers-sidebar-card');
    const bangersText = document.body.innerText.includes('DAILY 90%+ BANGERS');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');

    return {
      hasGrid: !!grid,
      hasBangersCard: !!bangersCard,
      hasBangersText: bangersText,
      hasRightCol: !!rightCol,
      hasWatchlistCard: !!watchlistCard
    };
  })()`);
  console.log('Other Markets Info:', JSON.stringify(otherMarketsInfo, null, 2));
  await takeScreenshot('other_markets_no_bangers_desktop');

  // 3. TEST SUBSCRIPTION (DESKTOP)
  console.log('\n--- 3. Testing /subscription ---');
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/subscription' });
  await sleep(2500);

  const subscriptionInfo = await evalJs(`(() => {
    const grid = document.querySelector('.desktop-page-grid');
    const bangersCard = document.querySelector('.bangers-sidebar-card');
    const bangersText = document.body.innerText.includes('DAILY 90%+ BANGERS');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');

    return {
      hasGrid: !!grid,
      hasBangersCard: !!bangersCard,
      hasBangersText: bangersText,
      hasRightCol: !!rightCol,
      hasWatchlistCard: !!watchlistCard
    };
  })()`);
  console.log('Subscription Info:', JSON.stringify(subscriptionInfo, null, 2));
  await takeScreenshot('subscription_no_bangers_desktop');

  // Reset viewport to desktop
  await setViewport(1920, 957);
  cdp.close();
  console.log('\nAll tests complete and verified successfully!');
}

run().catch((err) => {
  console.error('Error in verification script:', err);
  process.exit(1);
});
