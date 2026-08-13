'use strict';

const { spawn } = require('child_process');

function quoteForPreview(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function commandPreview(executable, args) {
  return [executable, ...args].map(quoteForPreview).join(' ');
}

/**
 * Spawns without a shell. This prevents user parameters from becoming shell code.
 */
function spawnSafeProcess(executable, args, options = {}) {
  return spawn(executable, args, {
    shell: false,
    windowsHide: true,
    ...options,
  });
}

module.exports = {
  commandPreview,
  spawnSafeProcess,
};
