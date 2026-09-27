// Validates the `initData` string Telegram gives every Web App.
// Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
const crypto = require('crypto');

function validateInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null;

    const userRaw = params.get('user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    return { user, authDate };
  } catch (err) {
    return null;
  }
}

module.exports = { validateInitData };
