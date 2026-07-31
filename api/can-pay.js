/* Trivex — private-testing gate.
   While the card issuer is not live, real payments must be limited to the
   operator's own wallets. TRON_PAYER_ALLOWLIST holds the permitted sender
   addresses (comma-separated); empty means nobody may pay (fail closed).
   PAYMENTS_OPEN=public lifts the gate once the product actually launches. */

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const open = (process.env.PAYMENTS_OPEN || 'private').toLowerCase() === 'public';
  if (open) return res.status(200).json({ ok: true, allowed: true, mode: 'public' });

  const address = String((req.query && req.query.address) || '').trim();
  const list = (process.env.TRON_PAYER_ALLOWLIST || '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean);

  const allowed = !!address && list.includes(address);
  return res.status(200).json({ ok: true, allowed, mode: 'private' });
}
