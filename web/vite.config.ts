import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Read root .env credentials into process.env for local API simulation
const rootEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(rootEnvPath)) {
  const content = fs.readFileSync(rootEnvPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function localApiDevPlugin(): Plugin {
  return {
    name: 'local-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const reqPath = req.url?.split('?')[0] || '';
        const apiModules: Record<string, string> = {
          '/api/predictions-feed': './api/predictions-feed.ts',
          '/api/basketball-feed': './api/basketball-feed.ts',
          '/api/goals-feed': './api/goals-feed.ts',
          '/api/tennis-feed': './api/tennis-feed.ts',
          '/api/market-feed': './api/market-feed.ts',
          '/api/send-welcome-email': './api/send-welcome-email.ts',
          '/api/send-subscription-email': './api/send-subscription-email.ts',
          '/api/send-password-reset-email': './api/send-password-reset-email.ts',
        };
        if (apiModules[reqPath]) {
          try {
            const modulePath = apiModules[reqPath];
            const resolvedPath = path.resolve(server.config.root, modulePath);
            const mod = server.moduleGraph.getModuleById(resolvedPath);
            if (mod) server.moduleGraph.invalidateModule(mod);
            const { default: handler } = await server.ssrLoadModule(modulePath);
            const fullUrl = `http://${req.headers.host || 'localhost:5173'}${req.url}`;
            
            let reqBody: string | undefined;
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              const chunks: any[] = [];
              for await (const chunk of req) {
                chunks.push(chunk);
              }
              if (chunks.length > 0) {
                reqBody = Buffer.concat(chunks).toString('utf8');
              }
            }

            const fetchReq = new Request(fullUrl, {
              method: req.method || 'GET',
              headers: req.headers as HeadersInit,
              body: reqBody,
            });
            const response = await handler(fetchReq);
            res.statusCode = response.status;
            response.headers.forEach((val: string, key: string) => res.setHeader(key, val));
            const body = await response.text();
            res.end(body);
            return;
          } catch (err) {
            console.error('[LOCAL-API-ERROR]', err);
            next();
          }
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiDevPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'https://www.oddsbanta.com',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
