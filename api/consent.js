/* Trivex — stores the signed terms-of-use acknowledgement.
   The wallet displays the message text on its approval screen, so the stored
   {message, signature} pair is the record of what the customer agreed to. */

import { put } from '@vercel/blob';

const ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const { address, tier, orderRef, message, signature } = req.body || {};
  if (!ADDR_RE.test(String(address || '')) ||
      typeof message !== 'string' || message.length > 4000 ||
      typeof signature !== 'string' || signature.length > 400) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }

  const record = {
    address,
    tier: typeof tier === 'string' ? tier.slice(0, 20) : null,
    orderRef: typeof orderRef === 'string' ? orderRef.slice(0, 20) : null,
    message,
    signature,
    at: new Date().toISOString()
  };

  try {
    await put(`consents/${Date.now()}-${address}.json`, JSON.stringify(record), {
      access: 'private', addRandomSuffix: true, contentType: 'application/json'
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('consent store failed:', err.message);
    return res.status(500).json({ ok: false, error: 'storage_error' });
  }
}
