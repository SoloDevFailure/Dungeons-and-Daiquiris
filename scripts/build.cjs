'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '_site');
fs.mkdirSync(output, {recursive:true});
// Explicit allowlist keeps unrelated documents and development files off Pages.
for (const item of ['index.html','presentation.html','styles.css','presentation.css',
  'app.js','pwa.js','sw.js','manifest.webmanifest','presentation.webmanifest','services','icons']) {
  fs.cpSync(path.join(root,item),path.join(output,item),{recursive:true});
}
fs.writeFileSync(path.join(output,'.nojekyll'),'');
console.log('Static site prepared in _site');
