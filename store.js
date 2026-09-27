// Very small file-backed JSON store. Good enough for one shop's worth of
// traffic. Writes are queued so two requests can't corrupt the file.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJSON(name, fallback) {
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

// Serialize writes per-file so concurrent requests can't race each other.
const writeQueues = new Map();
function writeJSON(name, data) {
  const p = filePath(name);
  const prev = writeQueues.get(name) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => fs.promises.writeFile(p, JSON.stringify(data, null, 2)));
  writeQueues.set(name, next);
  return next;
}

module.exports = { readJSON, writeJSON };
