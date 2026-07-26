// Runs automatically during the Netlify build (see netlify.toml).
// Reads the SUPABASE_URL and SUPABASE_ANON_KEY environment variables you set
// in the Netlify dashboard (Site settings -> Environment variables) and writes
// them into config.js, which is loaded by index.html before finmind.js.
//
// This keeps your real credentials OUT of your GitHub repo entirely.

const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

const content = `// AUTO-GENERATED at build time by scripts/generate-config.js
// Do not hand-edit this file, and never commit it with real values filled in.
window.SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
window.SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
`;

fs.writeFileSync('config.js', content);
console.log('config.js generated for this build.');
