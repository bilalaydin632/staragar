const PROFANITY_PATTERNS = [
  /amk/i, /aq/i, /oç/i, /piç/i, /yarrak/i, /got/i, /göt/i, /sik/i, /fuck/i, /shit/i,
  /bitch/i, /asshole/i, /dick/i, /pussy/i, /cock/i, /slut/i, /whore/i,
  /allah/i, /tanrı/i, /peygamber/i, /din/i, /kuran/i, /ısa/i, /muslüman/i, /müslüman/i,
  /hristiyan/i, /yahudi/i, /siyaset/i, /erdoğan/i, /atatürk/i, /chp/i, /akp/i,
  /mhp/i, /hdp/i, /pkk/i, /terör/i, /siyasi/i, /parti/i, /seçim/i,
  /bok/i, /salak/i, /aptal/i, /gerizekalı/i, /mal/i, /öküz/i,
  /kahpe/i, /orospu/i, /fahişe/i, /pezevenk/i, /kapıkulu/i
];

const lastMessageTime = new Map();

function containsProfanity(message) {
  const lower = message.toLowerCase();
  for (const pattern of PROFANITY_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  return false;
}

function isSpamming(nick) {
  const now = Date.now();
  const last = lastMessageTime.get(nick) || 0;
  if (now - last < 5000) return true;
  lastMessageTime.set(nick, now);
  return false;
}

function moderateMessage(message, nick) {
  if (containsProfanity(message)) {
    return { action: 'ban', reason: 'Küfür/argo/siyasi/dini hakaret tespit edildi' };
  }
  if (isSpamming(nick)) {
    return { action: 'block', reason: 'Spam engeli: 5 saniyeden kısa sürede tekrar mesaj' };
  }
  return { action: 'allow' };
}

function clearSpamTimer(nick) {
  lastMessageTime.delete(nick);
}

module.exports = { containsProfanity, isSpamming, moderateMessage, clearSpamTimer };
