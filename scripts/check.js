'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const dir of ['.', 'lib', 'renderer', 'scripts', 'tests']) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(dir, name)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
