'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '_site');
fs.mkdirSync(output, {recursive:true});
// Explicit allowlist keeps unrelated documents and development files off Pages.
for (const item of ['index.html','presentation.html','styles.css','presentation.css',
  'app.js','config.js','session-ui.js','presentation.js','pwa.js','sw.js','manifest.webmanifest','presentation.webmanifest','services','icons','assets']) {
  fs.cpSync(path.join(root,item),path.join(output,item),{recursive:true});
}
fs.writeFileSync(path.join(output,'.nojekyll'),'');
if (!fs.existsSync(path.join(output,'assets/presentation/tavern-backdrop.png'))) throw new Error('Required presentation backdrop is missing: assets/presentation/tavern-backdrop.png');
console.log('Static site prepared in _site');
