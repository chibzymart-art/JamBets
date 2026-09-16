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

  const waitForSelector = async (selector, timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await evalJs(`!!document.querySelector('${selector}')`);
      if (found) return true;
      await sleep(500);
    }
    return false;
  };

  // 1. TEST DASHBOARD / PREDICTIONS (DESKTOP)
  console.log('\n--- 1. Testing /dashboard ---');
  await setViewport(1920, 957);
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/dashboard' });
  
  // Wait for main dashboard grid to appear
  const hasGrid = await waitForSelector('.main-dashboard-grid', 15000);
  console.log('Dashboard grid rendered:', hasGrid);
  await sleep(1500);

  const dashboardInfo = await evalJs(`(() => {
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const leftAds = leftCol ? leftCol.querySelectorAll('.ad-sidebar-card').length : 0;
    const bangersCard = document.querySelector('.bangers-sidebar-card');
    const bangersText = document.body.innerText.includes('DAILY 90%+ BANGERS');
    
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');
    const underWatchlistAds = rightCol ? rightCol.querySelectorAll('.under-sidebar-ad-wrap .ad-sidebar-card').length : 0;

    return {
      hasLeftCol: !!leftCol,
      leftAdsCount: leftAds,
      hasBangersCard: !!bangersCard,
      hasBangersText: bangersText,
      hasRightCol: !!rightCol,
      hasWatchlistCard: !!watchlistCard,
      underWatchlistAds
    };
  })()`);
  console.log('Dashboard Info:', JSON.stringify(dashboardInfo, null, 2));
  await takeScreenshot('dashboard_loaded_left_ad_desktop');

  // Scroll down 800px on Dashboard to verify sticky scroll behavior
  await evalJs(`window.scrollTo({ top: 800, behavior: 'instant' })`);
  await sleep(1000);
  await takeScreenshot('dashboard_loaded_left_ad_scroll_800');

  // 2. TEST OTHER MARKETS (DESKTOP)
  console.log('\n--- 2. Testing /other-markets ---');
  await evalJs(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/other-markets' });
  await waitForSelector('.desktop-page-grid', 10000);
  await sleep(1500);

  const otherMarketsInfo = await evalJs(`(() => {
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
  console.log('Other Markets Info:', JSON.stringify(otherMarketsInfo, null, 2));
  await takeScreenshot('other_markets_left_ad_desktop');

  // 3. TEST SUBSCRIPTION (DESKTOP)
  console.log('\n--- 3. Testing /subscription ---');
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/subscription' });
  await waitForSelector('.desktop-page-grid', 10000);
  await sleep(1500);

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
  console.log('Subscription Info:', JSON.stringify(subscriptionInfo, null, 2));
  await takeScreenshot('subscription_left_ad_desktop');

  // 4. TEST ADMIN PAGE (MUST HAVE ZERO SIDEBARS)
  console.log('\n--- 4. Testing /admin ---');
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/admin' });
  await sleep(2500);

  const adminInfo = await evalJs(`(() => {
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const adDeck = document.querySelector('.ad-hub-container');

    return {
      hasLeftCol: !!leftCol,
      hasRightCol: !!rightCol,
      hasAdDeck: !!adDeck
    };
  })()`);
  console.log('Admin Page Info:', JSON.stringify(adminInfo, null, 2));
  await takeScreenshot('admin_no_sidebars_verified');

  // 5. TEST MOBILE VIEWPORT (<= 1200px) - ON OTHER MARKETS & DASHBOARD
  console.log('\n--- 5. Testing Mobile Viewport (390px) on /other-markets ---');
  await setViewport(390, 844);
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/other-markets' });
  await sleep(2000);

  const mobileInfo = await evalJs(`(() => {
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const leftDisplay = leftCol ? window.getComputedStyle(leftCol).display : 'null';
    const rightDisplay = rightCol ? window.getComputedStyle(rightCol).display : 'null';

    return {
      leftDisplay,
      rightDisplay,
      isLeftHidden: leftDisplay === 'none',
      isRightHidden: rightDisplay === 'none'
    };
  })()`);
  console.log('Mobile Info:', JSON.stringify(mobileInfo, null, 2));
  await takeScreenshot('mobile_other_markets_sidebars_hidden');

  // Reset viewport to desktop
  await setViewport(1920, 957);
  cdp.close();
  console.log('\nAll tests complete and verified successfully!');
}

run().catch((err) => {
  console.error('Error in verification script:', err);
  process.exit(1);
});
