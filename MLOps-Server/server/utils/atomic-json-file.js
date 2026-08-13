'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Reads JSON and returns fallback when the file does not exist.
 * Invalid JSON is surfaced to the caller so corrupted state is not hidden.
 */
function readJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Writes JSON atomically by replacing the target with a completed temporary file.
 */
function writeJsonFileAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  readJsonFile,
  writeJsonFileAtomic,
};
