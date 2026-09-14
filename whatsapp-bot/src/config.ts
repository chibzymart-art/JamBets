import path from 'path';
import dotenv from 'dotenv';

// Load .env from whatsapp-bot directory or workspace root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  adminEmails: [
    'chibzymart@gmail.com',
    'whizzchibz@gmail.com',
    'chibuezec.amuchie@gmail.com',
    'chibuezeamuchie@gmail.com',
    'nnamdiamuchie@gmail.com'
  ],
  authDir: process.env.AUTH_DIR || path.resolve(__dirname, '../auth_info'),
  port: parseInt(process.env.PORT || '8080', 10),
  websiteUrl: 'https://oddsbanta.com'
};
