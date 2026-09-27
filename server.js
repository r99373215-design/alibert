// Minimal, dependency-free .env loader for local development.
// On Render (or any real host) you set these in the dashboard instead,
// so this is just a convenience — nothing breaks if .env is missing.
function loadDotEnv() {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  });
}
loadDotEnv();

const path = require('path');
const express = require('express');
const { readJSON, writeJSON } = require('./lib/store');
const { validateInitData } = require('./lib/telegramAuth');
const { sendMessage, setWebhook } = require('./lib/telegramApi');

const PORT = process.env.PORT || 3000;
const SHOP_BOT_TOKEN = process.env.SHOP_BOT_TOKEN;
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me';
// Render sets this automatically; set PUBLIC_URL yourself for other hosts.
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';

if (!SHOP_BOT_TOKEN || !ADMIN_BOT_TOKEN) {
  console.error('Missing SHOP_BOT_TOKEN or ADMIN_BOT_TOKEN in environment. See .env.example.');
}
if (ADMIN_IDS.length === 0) {
  console.warn('WARNING: ADMIN_IDS is empty — nobody will be able to use the admin bot yet.');
}

const DEFAULT_PRODUCTS = readJSON('products', []); // seeded once, then lives in data/products.json
const app = express();
app.use(express.json({ limit: '15mb' })); // photos come in as base64 data URLs

// ---------------------------------------------------------------------------
// Static front-ends
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Admin auth: every write to /api/products and every read of /api/orders
// requires a valid, fresh Telegram initData string from the ADMIN bot,
// belonging to a user id listed in ADMIN_IDS.
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  const initData = req.header('x-init-data') || '';
  const result = validateInitData(initData, ADMIN_BOT_TOKEN);
  if (!result || !result.user) {
    return res.status(401).json({ error: 'Invalid Telegram session. Open this page from the admin bot.' });
  }
  if (!ADMIN_IDS.includes(String(result.user.id))) {
    return res.status(403).json({ error: 'This Telegram account is not an admin.' });
  }
  req.telegramUser = result.user;
  next();
}

app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true, user: req.telegramUser });
});

// ---------------------------------------------------------------------------
// Products — readable by everyone (the shop needs them), writable by admin only
// ---------------------------------------------------------------------------
app.get('/api/products', (req, res) => {
  res.json(readJSON('products', DEFAULT_PRODUCTS));
});

app.post('/api/products', requireAdmin, async (req, res) => {
  const products = readJSON('products', []);
  const product = { ...req.body, id: Date.now() };
  products.unshift(product);
  await writeJSON('products', products);
  res.json(product);
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const products = readJSON('products', []);
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  products[idx] = { ...products[idx], ...req.body, id };
  await writeJSON('products', products);
  res.json(products[idx]);
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const products = readJSON('products', []).filter((p) => p.id !== id);
  await writeJSON('products', products);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Orders — anyone can create one (a customer checking out), only admin can list them
// ---------------------------------------------------------------------------
app.get('/api/orders', requireAdmin, (req, res) => {
  res.json(readJSON('orders', []));
});

app.post('/api/orders', async (req, res) => {
  const orders = readJSON('orders', []);
  const order = { ...req.body, id: req.body.id || '#' + Date.now().toString(36).toUpperCase(), receivedAt: new Date().toISOString() };
  orders.unshift(order);
  await writeJSON('orders', orders);

  // Ping every admin so they see new orders instantly, without opening the app.
  const itemsText = (order.items || [])
    .map((i) => `• ${i.name} × ${i.qty} — ${i.price}₽`)
    .join('\n');
  const text = `🛒 <b>New order ${order.id}</b>\nCustomer: ${order.customerName || order.phone || 'unknown'}\nPhone: ${order.phone || '—'}\nTotal: ${order.total || 0}₽\n\n${itemsText}`;
  ADMIN_IDS.forEach((chatId) => sendMessage(ADMIN_BOT_TOKEN, chatId, text));

  res.json(order);
});

app.patch('/api/orders/:id', requireAdmin, async (req, res) => {
  const orders = readJSON('orders', []);
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  orders[idx] = { ...orders[idx], ...req.body };
  await writeJSON('orders', orders);
  res.json(orders[idx]);
});

// ---------------------------------------------------------------------------
// Telegram webhooks — one path per bot, both guarded by a secret token that
// only Telegram (and you) know.
// ---------------------------------------------------------------------------
function webAppKeyboard(url, label) {
  return { reply_markup: { inline_keyboard: [[{ text: label, web_app: { url } }]] } };
}

app.post(`/webhook/shop/${WEBHOOK_SECRET}`, express.json(), async (req, res) => {
  res.sendStatus(200); // ack immediately, Telegram doesn't wait for the reply
  const msg = req.body.message;
  if (!msg || !msg.text) return;
  if (msg.text.startsWith('/start')) {
    const shopUrl = `${PUBLIC_URL}/index.html`;
    await sendMessage(SHOP_BOT_TOKEN, msg.chat.id, 'Welcome! Tap below to open the shop.', webAppKeyboard(shopUrl, '🛍 Open shop'));
  }
});

app.post(`/webhook/admin/${WEBHOOK_SECRET}`, express.json(), async (req, res) => {
  res.sendStatus(200);
  const msg = req.body.message;
  if (!msg || !msg.text) return;
  const isAdmin = ADMIN_IDS.includes(String(msg.from.id));
  if (!isAdmin) {
    await sendMessage(ADMIN_BOT_TOKEN, msg.chat.id, `Access denied. Your Telegram id is ${msg.from.id} — ask the owner to add it to ADMIN_IDS.`);
    return;
  }
  if (msg.text.startsWith('/start')) {
    const adminUrl = `${PUBLIC_URL}/admin.html`;
    await sendMessage(ADMIN_BOT_TOKEN, msg.chat.id, 'Admin panel:', webAppKeyboard(adminUrl, '⚙️ Open admin panel'));
  }
});

// ---------------------------------------------------------------------------
app.listen(PORT, async () => {
  console.log(`Server listening on :${PORT}`);
  if (PUBLIC_URL) {
    const shopHook = `${PUBLIC_URL}/webhook/shop/${WEBHOOK_SECRET}`;
    const adminHook = `${PUBLIC_URL}/webhook/admin/${WEBHOOK_SECRET}`;
    const r1 = await setWebhook(SHOP_BOT_TOKEN, shopHook, WEBHOOK_SECRET);
    const r2 = await setWebhook(ADMIN_BOT_TOKEN, adminHook, WEBHOOK_SECRET);
    console.log('Shop webhook set:', r1.ok ? 'OK' : r1);
    console.log('Admin webhook set:', r2.ok ? 'OK' : r2);
  } else {
    console.log('PUBLIC_URL not set — skipping automatic setWebhook. See README for manual setup.');
  }
});
