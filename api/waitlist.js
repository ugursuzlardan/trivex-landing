/* Trivex — waitlist API: stores signups in Vercel Blob */
import { put } from '@vercel/blob';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const { email, lang, tier, website } = req.body || {};

  // honeypot: real users never fill this hidden field
  if (website) return res.status(200).json({ ok: true });

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 120) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }

  const record = {
    email: email.trim().toLowerCase(),
    lang: typeof lang === 'string' ? lang.slice(0, 5) : null,
    tier: typeof tier === 'string' ? tier.slice(0, 20) : null,
    at: new Date().toISOString(),
    ua: (req.headers['user-agent'] || '').slice(0, 200)
  };

  try {
    await put(
      `waitlist/${Date.now()}.json`,
      JSON.stringify(record),
      { access: 'private', addRandomSuffix: true, contentType: 'application/json' }
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('waitlist put failed:', err.message);
    return res.status(500).json({ ok: false, error: 'storage_error' });
  }
}
