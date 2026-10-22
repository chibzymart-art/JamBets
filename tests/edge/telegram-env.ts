// Loaded before the Telegram webhook so its module-level config sees test values.
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests-only-0000';
process.env.SUPABASE_URL = 'https://db.test';
export {};
