import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\b2db48ac-78f1-40f0-95ae-728316faf141';
const PORT = 9226;

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
  console.log('🚀 Launching Chrome to inspect http://localhost:5173/tennis (Phase 3 Full Suite) ...');
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

    // Click 'All Dates' tab if present
    const clickedTab = await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('.tennis-date-tab, button'));
        const target = tabs.find(t => t.textContent.includes('All Dates')) || tabs.find(t => t.textContent.includes('Today')) || tabs[0];
        if (target) {
          target.click();
          return target.textContent.trim();
        }
        return null;
      })()
    `);
    console.log(`Clicked tab: ${clickedTab}`);
    await sleep(2500);

    // Expand first 10 cards
    await client.evaluate(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.fixture-card.glance-fixture-box'));
        cards.slice(0, 10).forEach(card => card.click());
      })()
    `);
    await sleep(2000);

    // Evaluate cards
    const detailedAudit = await client.evaluate(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.fixture-card.glance-fixture-box'));
        const results = [];
        let duplicateMatchWinnerCount = 0;
        let totalSecondaryTiles = 0;

        cards.forEach((card, cIdx) => {
          const players = Array.from(card.querySelectorAll('.glance-team-name')).map(p => p.textContent.trim());
          const tournament = card.querySelector('.glance-league-pill')?.textContent?.trim();
          const primaryPick = card.querySelector('.sniper-outcome-val')?.textContent?.trim();
          const primaryProb = card.querySelector('.sniper-prob-val')?.textContent?.trim();
          const isExpanded = !!card.querySelector('.expanded-breakdown-body');

          const secTiles = Array.from(card.querySelectorAll('.tennis-secondary-pred-tile')).map(tile => {
            totalSecondaryTiles++;
            const title = tile.querySelector('div[style*="font-size: 10.5"]')?.textContent?.trim();
            const pick = tile.querySelector('div[style*="font-size: 13.5"]')?.textContent?.trim();
            const prob = tile.querySelector('div[style*="font-size: 14"]')?.textContent?.trim();
            const vipLock = tile.querySelector('div[style*="font-size: 11"]')?.textContent?.trim();

            if (title && (title.includes('MATCH WINNER') || title.includes('Match Winner'))) {
              duplicateMatchWinnerCount++;
            }

            return { title, pick, prob, vipLock };
          });

          if (isExpanded) {
            results.push({
              index: cIdx,
              players: players.join(' vs '),
              tournament,
              primaryPick,
              primaryProb,
              secondaryTilesCount: secTiles.length,
              secondaryTiles: secTiles
            });
          }
        });

        return {
          totalCards: cards.length,
          expandedCardsCount: results.length,
          totalSecondaryTiles,
          duplicateMatchWinnerCount,
          cardsSample: results.slice(0, 8)
        };
      })()
    `);

    console.log('\n================================================================================');
    console.log(' PHASE 3 CLIENT-SIDE DOM & CONTRACT AUDIT');
    console.log('================================================================================');
    console.log(`Total Cards in DOM: ${detailedAudit.totalCards}`);
    console.log(`Total Expanded Cards Audited: ${detailedAudit.expandedCardsCount}`);
    console.log(`Total Secondary Tiles Rendered: ${detailedAudit.totalSecondaryTiles}`);
    console.log(`Duplicate Match Winner in Secondary Grid: ${detailedAudit.duplicateMatchWinnerCount === 0 ? '✅ ZERO (PASS)' : `❌ ${detailedAudit.duplicateMatchWinnerCount} FOUND`}`);
    console.log('\nSample Cards Details:');
    console.log(JSON.stringify(detailedAudit.cardsSample, null, 2));

    await client.captureScreenshot('tennis_ui_phase3_inspection.png');
    console.log('\n✅ Phase 3 Verification Complete.');
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
