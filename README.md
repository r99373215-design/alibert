# Telegram Shop — 2 bots, 1 real backend

What changed from the two HTML files you had:

- Both pages used to store products in the browser's `localStorage`. That
  means every visitor saw their **own private copy** of the catalog — an
  edit in `admin.html` never reached anyone else, including real customers.
- Now there's a small Node.js server that owns the actual product/order data
  (in `data/products.json` and `data/orders.json`). Both bots talk to it.
- `admin.html` is now **locked down**: it checks the visitor's real Telegram
  identity (via Telegram's own signed `initData`) against an `ADMIN_IDS`
  allow-list before it lets anyone see or touch the product form. If you open
  it outside Telegram, or from an account not on the list, it refuses.
- `index.html` (your shop) now fetches the live catalog from the server on
  load, and posts real orders to it — which also pings you on the admin bot
  the instant someone orders.

## 1. Create the two bots (you said you already have this — keep the tokens handy)

For each bot, in a chat with **@BotFather**:
- `/newbot` → gives you a token like `123456789:AA...`
- `/setmenubutton` (optional) → nice-to-have, not required, since `/start` already opens the Web App button.

You need **two different tokens** — one for the shop bot, one for the admin bot.

## 2. Find your own Telegram numeric ID

Message **@userinfobot** — it replies with your numeric ID. That's what goes
into `ADMIN_IDS`. You can list several IDs, comma-separated, if more than one
person should be able to manage products.

## 3. Deploy the backend (recommended: Render.com, free tier)

Render is the easiest zero-cost option that gives you a real HTTPS URL,
which Telegram Web Apps require.

1. Push this folder to a GitHub repo (or use Render's "Upload" flow if you
   don't want Git).
2. On https://render.com → **New → Web Service** → connect the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Add environment variables (Render dashboard → Environment):
   - `SHOP_BOT_TOKEN` = your shop bot's token
   - `ADMIN_BOT_TOKEN` = your admin bot's token
   - `ADMIN_IDS` = your Telegram numeric ID(s), comma-separated
   - `WEBHOOK_SECRET` = any random string you make up
   - (`PUBLIC_URL` — leave this one unset; Render provides
     `RENDER_EXTERNAL_URL` automatically and the server uses it.)
5. Deploy. On boot, the server automatically registers both bots' webhooks
   pointing at your new Render URL — check the deploy logs for
   `Shop webhook set: OK` / `Admin webhook set: OK`.

**Free-tier note:** Render's free web services spin down after ~15 minutes
idle and take a few seconds to wake back up on the next request (including
the next `/start`). That's normal — it doesn't lose any data, it's just a
cold-start delay. If that's ever annoying, upgrading to a paid instance
removes it.

**Persistence note:** the free tier's disk is wiped on every new deploy
(pushing new code). Your product catalog will survive restarts but not
redeploys. For anything beyond testing/early use, add a Render persistent
disk (small paid add-on) mounted at `/opt/render/project/src/data`, or
migrate `lib/store.js` to a real hosted database later — the rest of the
code doesn't need to change, only those two functions.

## 4. Try it

- Message your **shop bot** → `/start` → tap "🛍 Open shop" → the storefront
  opens as a Telegram Web App and loads the live catalog.
- Message your **admin bot** (from an account listed in `ADMIN_IDS`) →
  `/start` → tap "⚙️ Open admin panel" → add/edit/delete a product → it's
  immediately visible to real customers in the shop bot.
- Message the **admin bot from a different account**: it replies "Access
  denied" and tells you that account's numeric ID (handy for adding more
  admins later).

## 5. Running locally (optional, for testing before you deploy)

```bash
npm install
cp .env.example .env   # fill in your real tokens + your Telegram ID
npm start
```

Locally there's no public HTTPS URL, so the server skips registering
webhooks automatically (you'll see a log line saying so) and Telegram can't
reach your machine — but you can still hit `http://localhost:3000` in a
browser to sanity-check the shop page renders (the Telegram-only admin check
will correctly refuse access outside of Telegram, which is expected).

## Project layout

```
server.js              Express app: static hosting + API + both bot webhooks
lib/telegramAuth.js     Verifies Telegram's signed initData
lib/telegramApi.js      Tiny Telegram Bot API client (sendMessage, setWebhook)
lib/store.js            Simple JSON-file database (products.json / orders.json)
public/index.html       Your shop, now loading/posting to the real API
public/admin.html       Your admin panel, now gated by real Telegram auth
data/                   Where the JSON "database" lives
```
