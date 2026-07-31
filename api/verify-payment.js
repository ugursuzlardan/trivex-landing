/* Trivex — on-chain payment verification (TRON, USDT TRC-20).
   Client submits the txid of its signed transfer; we confirm against TronGrid:
   right contract, right recipient, right amount, confirmed — then record the
   order in the private Blob store. put() with a fixed pathname refuses to
   overwrite, which doubles as replay protection (one txid = one order). */

import { put } from '@vercel/blob';

const TIERS = {
  lite:     { price: 0,   minTopup: 10 },
  plus:     { price: 15,  minTopup: 10 },
  platinum: { price: 49,  minTopup: 10 },
  black:    { price: 199, minTopup: 10 }
};

const TXID_RE = /^[0-9a-f]{64}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const { txid, tier } = req.query || {};
  if (!txid || !TXID_RE.test(txid) || !tier || !TIERS[tier]) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }

  const network = process.env.TRON_NETWORK || 'nile';
  const address = process.env.TRON_RECEIVING_ADDRESS;
  const usdtContract = process.env.TRON_USDT_CONTRACT;
  if (!address || !usdtContract) {
    return res.status(503).json({ ok: false, error: 'payment_not_configured' });
  }

  const base = network === 'mainnet' ? 'https://api.trongrid.io' : 'https://nile.trongrid.io';
  const expected = Math.round((TIERS[tier].price + TIERS[tier].minTopup) * 1e6);

  let transfers;
  try {
    const r = await fetch(
      `${base}/v1/accounts/${address}/transactions/trc20` +
      `?only_confirmed=true&only_to=true&limit=100&contract_address=${usdtContract}`,
      { headers: { accept: 'application/json' } }
    );
    if (!r.ok) throw new Error(`trongrid_${r.status}`);
    transfers = (await r.json()).data || [];
  } catch (err) {
    console.error('trongrid query failed:', err.message);
    return res.status(502).json({ ok: false, error: 'chain_unavailable' });
  }

  const match = transfers.find(t =>
    t.transaction_id === txid.toLowerCase() &&
    t.to === address &&
    (t.type === 'Transfer' || !t.type)
  );

  if (!match) {
    // not visible/confirmed yet — client keeps polling
    return res.status(200).json({ ok: true, status: 'pending' });
  }

  if (Number(match.value) < expected) {
    return res.status(200).json({ ok: false, status: 'underpaid', expected });
  }

  const order = {
    txid: txid.toLowerCase(),
    tier,
    from: match.from,
    amount: match.value,
    network,
    at: new Date().toISOString()
  };

  try {
    await put(`orders/${txid.toLowerCase()}.json`, JSON.stringify(order), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json'
    });
  } catch (err) {
    // fixed pathname + no overwrite → a second claim of the same txid lands here
    if (/exists|conflict/i.test(err.message || '')) {
      return res.status(200).json({ ok: false, status: 'already_used' });
    }
    console.error('order store failed:', err.message);
    return res.status(500).json({ ok: false, error: 'storage_error' });
  }

  return res.status(200).json({ ok: true, status: 'confirmed', tier });
}
