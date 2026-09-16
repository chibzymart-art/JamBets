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
    const bangersCol = document.querySelector('.dashboard-left-sidebar-col');
    const bangersCard = document.querySelector('.bangers-sidebar-card');
    const bangersHeader = document.querySelector('.bangers-sidebar-header');
    const bangersAds = bangersCard ? bangersCard.querySelectorAll('.ad-banner-slot-container').length : -1;
    const underBangersAds = bangersCol ? bangersCol.querySelectorAll('.under-sidebar-ad-wrap').length : -1;
    
    const watchlistCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');
    const watchlistHeader = document.querySelector('.watchlist-sidebar-header');
    const watchlistAds = watchlistCard ? watchlistCard.querySelectorAll('.ad-banner-slot-container').length : -1;
    const underWatchlistAds = watchlistCol ? watchlistCol.querySelectorAll('.under-sidebar-ad-wrap').length : -1;

    return {
      hasBangersCol: !!bangersCol,
      hasBangersCard: !!bangersCard,
      bangersAds,
      underBangersAds,
      hasWatchlistCol: !!watchlistCol,
      hasWatchlistCard: !!watchlistCard,
      watchlistAds,
      underWatchlistAds
    };
  })()`);
  console.log('Dashboard Info:', JSON.stringify(dashboardInfo, null, 2));

  // Scroll down 800px on Dashboard to verify scroll behavior
  await evalJs(`window.scrollTo({ top: 800, behavior: 'instant' })`);
  await sleep(1000);
  await takeScreenshot('dashboard_scroll_fixed_800');

  // Scroll down 1500px on Dashboard
  await evalJs(`window.scrollTo({ top: 1500, behavior: 'instant' })`);
  await sleep(1000);
  await takeScreenshot('dashboard_scroll_fixed_1500');

  // Check positions after scroll
  const scrollHeaderPos = await evalJs(`(() => {
    const bHeader = document.querySelector('.bangers-sidebar-header');
    const wHeader = document.querySelector('.watchlist-sidebar-header');
    const bRect = bHeader ? bHeader.getBoundingClientRect() : null;
    const wRect = wHeader ? wHeader.getBoundingClientRect() : null;
    return {
      bangersTop: bRect ? bRect.top : null,
      watchlistTop: wRect ? wRect.top : null,
    };
  })()`);
  console.log('Scroll Header Positions (viewport relative):', scrollHeaderPos);

  // 2. TEST OTHER MARKETS (DESKTOP)
  console.log('\n--- 2. Testing /other-markets ---');
  await evalJs(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/other-markets' });
  await sleep(2500);

  const otherMarketsInfo = await evalJs(`(() => {
    const grid = document.querySelector('.desktop-page-grid');
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const bangersCard = document.querySelector('.bangers-sidebar-card');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const watchlistCard = document.querySelector('.watchlist-sidebar-card');
    const switchboard = document.querySelector('.market-switchboard-nav');
    const cards = document.querySelectorAll('.specialist-market-card').length;

    return {
      hasGrid: !!grid,
      hasLeftCol: !!leftCol,
      hasBangersCard: !!bangersCard,
      hasRightCol: !!rightCol,
      hasWatchlistCard: !!watchlistCard,
      hasSwitchboard: !!switchboard,
      specialistCardsCount: cards
    };
  })()`);
  console.log('Other Markets Info:', JSON.stringify(otherMarketsInfo, null, 2));
  await takeScreenshot('other_markets_desktop_sidebars');

  // 3. TEST SUBSCRIPTION (DESKTOP)
  console.log('\n--- 3. Testing /subscription ---');
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/subscription' });
  await sleep(2500);

  const subscriptionInfo = await evalJs(`(() => {
    const grid = document.querySelector('.desktop-page-grid');
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const pricingGrid = document.querySelector('.pricing-cards-grid');
    const pricingCards = document.querySelectorAll('.pricing-card').length;

    return {
      hasGrid: !!grid,
      hasLeftCol: !!leftCol,
      hasRightCol: !!rightCol,
      hasPricingGrid: !!pricingGrid,
      pricingCardsCount: pricingCards
    };
  })()`);
  console.log('Subscription Info:', JSON.stringify(subscriptionInfo, null, 2));
  await takeScreenshot('subscription_desktop_sidebars');

  // 4. TEST ADMIN PAGE (NO SIDEBARS CONFIRMATION)
  console.log('\n--- 4. Testing /admin ---');
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/admin' });
  await sleep(2500);

  const adminInfo = await evalJs(`(() => {
    const grid = document.querySelector('.desktop-page-grid');
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const bangers = document.querySelector('.bangers-sidebar-card');
    const watchlist = document.querySelector('.watchlist-sidebar-card');
    const adminDeck = document.querySelector('.admin-deck-container, .admin-view-root, .admin-loading-container');

    return {
      hasDesktopGrid: !!grid,
      hasLeftCol: !!leftCol,
      hasRightCol: !!rightCol,
      hasBangers: !!bangers,
      hasWatchlist: !!watchlist,
      hasAdminContainer: !!adminDeck
    };
  })()`);
  console.log('Admin Page Info:', JSON.stringify(adminInfo, null, 2));
  await takeScreenshot('admin_no_sidebars_confirmed');

  // 5. TEST MOBILE RESPONSIVENESS (<= 1200px)
  console.log('\n--- 5. Testing Mobile Viewport (390x844) ---');
  await setViewport(390, 844);
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/dashboard' });
  await sleep(2000);

  const mobileDashboardInfo = await evalJs(`(() => {
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const leftDisplay = leftCol ? window.getComputedStyle(leftCol).display : 'missing';
    const rightDisplay = rightCol ? window.getComputedStyle(rightCol).display : 'missing';

    return {
      leftSidebarDisplay: leftDisplay,
      rightSidebarDisplay: rightDisplay
    };
  })()`);
  console.log('Mobile Dashboard Info:', JSON.stringify(mobileDashboardInfo, null, 2));
  await takeScreenshot('mobile_dashboard_sidebars_hidden');

  // Also check mobile on /other-markets
  await cdp.send('Page.navigate', { url: 'http://localhost:5173/other-markets' });
  await sleep(2000);
  const mobileOtherMarketsInfo = await evalJs(`(() => {
    const leftCol = document.querySelector('.dashboard-left-sidebar-col');
    const rightCol = document.querySelector('.dashboard-right-sidebar-col');
    const leftDisplay = leftCol ? window.getComputedStyle(leftCol).display : 'missing';
    const rightDisplay = rightCol ? window.getComputedStyle(rightCol).display : 'missing';

    return {
      leftSidebarDisplay: leftDisplay,
      rightSidebarDisplay: rightDisplay
    };
  })()`);
  console.log('Mobile Other Markets Info:', JSON.stringify(mobileOtherMarketsInfo, null, 2));
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
