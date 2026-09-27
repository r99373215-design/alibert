const API = 'https://api.telegram.org';

function callTelegram(botToken, method, payload) {
  return fetch(`${API}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .catch((err) => ({ ok: false, error: String(err) }));
}

function sendMessage(botToken, chatId, text, extra = {}) {
  return callTelegram(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

function setWebhook(botToken, url, secretToken) {
  return callTelegram(botToken, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message'],
  });
}

module.exports = { callTelegram, sendMessage, setWebhook };
