// Loaded before the handler so its module-level key constants see new-style Supabase keys.
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'sb_publishable_testanonkey';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_testservicekey';
delete process.env.VITE_SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_URL;
