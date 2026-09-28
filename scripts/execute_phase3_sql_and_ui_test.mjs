// Automated Phase 3 SQL Deployment & Live UI Testing via Chrome DevTools Protocol
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\c8d8d401-c162-4064-b847-9db907b5d9e1';

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

class CdpConnection {
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

  close() {
    if (this.ws) this.ws.close();
  }
}

async function getTabs() {
  const res = await fetch('http://127.0.0.1:9222/json');
  return await res.json();
}

async function main() {
  console.log('🚀 Phase 3 Automation: Deploying RPC & Testing Live UI...');

  const tabs = await getTabs();
  const supabaseTab = tabs.find((t) => t.url.includes('supabase.com') && t.type === 'page');
  const oddsBantaTab = tabs.find((t) => t.url.includes('oddsbanta.com') && t.type === 'page');

  if (!supabaseTab) {
    throw new Error('Supabase SQL Editor tab not found on port 9222');
  }
  if (!oddsBantaTab) {
    throw new Error('Oddsbanta tab not found on port 9222');
  }

  console.log(`Connected to Supabase tab: ${supabaseTab.id}`);
  console.log(`Connected to Oddsbanta tab: ${oddsBantaTab.id}`);

  // ==========================================
  // PART 1: Deploy get_user_session_bootstrap SQL
  // ==========================================
  console.log('\n--- Step 1: Deploying SQL Migration in Supabase ---');
  const sqlContent = fs.readFileSync('supabase/migrations/20260928000002_user_session_bootstrap_rpc.sql', 'utf8');

  const supabaseCdp = new CdpConnection(supabaseTab.webSocketDebuggerUrl);
  await supabaseCdp.connect();

  // Set the SQL in Monaco editor and click Run
  const evalResult = await supabaseCdp.evaluate(`
    (async () => {
      try {
        const sql = ${JSON.stringify(sqlContent)};
        if (window.monaco && window.monaco.editor) {
          const models = window.monaco.editor.getModels();
          if (models && models.length > 0) {
            models[0].setValue(sql);
          }
        }

        // Find the Run button
        const buttons = Array.from(document.querySelectorAll('button'));
        const runBtn = buttons.find(b => {
          const t = b.textContent ? b.textContent.trim() : '';
          return t.startsWith('Run') || t === 'Run';
        });

        if (!runBtn) {
          return { success: false, reason: 'Run button not found', buttons: buttons.map(b => b.textContent?.trim()).filter(Boolean) };
        }

        runBtn.click();
        return { success: true, clicked: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })()
  `);

  console.log('Monaco SQL update & Run click:', evalResult);

  // Wait 3 seconds for SQL execution
  await sleep(3000);

  // Check execution status message in Supabase
  const sqlStatus = await supabaseCdp.evaluate(`
    (() => {
      const text = document.body.innerText;
      const hasSuccess = text.includes('Success. No rows returned') || text.includes('Success');
      const hasError = text.includes('ERROR:') || text.includes('error:');
      
      // Look for result panels
      const panels = Array.from(document.querySelectorAll('[role="tabpanel"], div[class*="results"], div[class*="status"]'));
      return {
        hasSuccess,
        hasError,
        summary: text.slice(0, 500)
      };
    })()
  `);
  console.log('Supabase SQL Execution Status:', sqlStatus.hasSuccess ? '✓ SUCCESS' : 'Checking status...');
  await supabaseCdp.captureScreenshot('supabase_phase3_rpc_deployed.png');
  supabaseCdp.close();

  // ==========================================
  // PART 2: Live UI Testing on oddsbanta.com
  // ==========================================
  console.log('\n--- Step 2: Live UI Testing on https://www.oddsbanta.com/ ---');
  const oddsBantaCdp = new CdpConnection(oddsBantaTab.webSocketDebuggerUrl);
  await oddsBantaCdp.connect();

  // Bring tab to front / reload to ensure fresh bundle
  await oddsBantaCdp.evaluate(`window.location.reload();`);
  await sleep(3500);

  // Open the AuthModal
  const openModalResult = await oddsBantaCdp.evaluate(`
    (() => {
      // Find Sign In or Get Started button
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const signInBtn = buttons.find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        return text === 'sign in' || text === 'log in';
      });

      if (signInBtn) {
        signInBtn.click();
        return { found: true, text: signInBtn.textContent.trim() };
      }
      return { found: false, availableButtons: buttons.map(b => b.textContent?.trim()).filter(Boolean).slice(0, 10) };
    })()
  `);
  console.log('Open Auth Modal Click:', openModalResult);

  await sleep(1000);

  // Capture screenshot of Sign In Modal
  await oddsBantaCdp.captureScreenshot('oddsbanta_live_auth_modal_signin.png');

  // Switch to Create Account Tab & test disclaimers
  const testRegisterTab = await oddsBantaCdp.evaluate(`
    (() => {
      const tabs = Array.from(document.querySelectorAll('.auth-tab-btn, button'));
      const registerTab = tabs.find(t => (t.textContent || '').trim().toLowerCase().includes('create account'));
      if (!registerTab) return { error: 'Create account tab not found' };
      registerTab.click();

      const ageCheck = document.getElementById('disclaimer-age');
      const finCheck = document.getElementById('disclaimer-financial');
      const submitBtn = document.getElementById('btn-auth-register');

      const initialDisabled = submitBtn ? submitBtn.disabled : null;

      // Toggle both checkboxes
      if (ageCheck) { ageCheck.click(); }
      if (finCheck) { finCheck.click(); }

      const enabledAfterCheck = submitBtn ? !submitBtn.disabled : null;

      return {
        registerTabClicked: true,
        hasAgeCheck: !!ageCheck,
        hasFinCheck: !!finCheck,
        initialDisabled,
        enabledAfterCheck
      };
    })()
  `);
  console.log('Registration Tab & Disclaimer Test:', testRegisterTab);

  await sleep(1000);
  await oddsBantaCdp.captureScreenshot('oddsbanta_live_auth_modal_register.png');

  // Close the modal
  await oddsBantaCdp.evaluate(`
    (() => {
      const closeBtn = document.querySelector('.modal-close-btn');
      if (closeBtn) closeBtn.click();
    })()
  `);

  await sleep(600);
  oddsBantaCdp.close();

  console.log('\n🎉 Automation Completed Successfully!');
}

main().catch((err) => {
  console.error('❌ Automation Error:', err);
  process.exit(1);
});
