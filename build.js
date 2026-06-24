/**
 * ZAHAN SHOP — build.js
 * Injects Supabase credentials from Vercel environment variables into app.js
 * Run automatically by Vercel on every deploy.
 * Same pattern as zahanportal/build.js
 */

const fs = require('fs');

const SUPABASE_URL      = process.env.SUPABASE_URL       || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY  || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('⚠️  SUPABASE_URL or SUPABASE_ANON_KEY is missing from environment variables.');
  console.warn('    Set them in: Vercel → Project Settings → Environment Variables');
}

let app = fs.readFileSync('app.js', 'utf8');
app = app
  .replace('__YOUR_SUPABASE_URL__',      SUPABASE_URL)
  .replace('__YOUR_SUPABASE_ANON_KEY__', SUPABASE_ANON_KEY);
fs.writeFileSync('app.js', app);

console.log('✅ Zahan Shop — credentials injected into app.js');
