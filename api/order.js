/* Trivex — order lifecycle.

   create: reserve a unique amount for the chosen chain and return what the
           customer must send.
   status: look for that payment on-chain; when it lands, the order completes
           on its own — no transaction hash, no copy-paste. */

import { put } from '@vercel/blob';
import { getChain } from './_chains.js';
import { TIERS } from './_tron.js';
import { makeRef, uniqueAmount, saveOrder, loadOrder, ORDER_TTL_MS } from './_orders.js';
import { findPayment } from './_watch.js';
import { rpc } from './_evm.js';

const REF_RE = /^[a-z0-9]{10}$/;

function allowedPayer(from) {
  if ((process.env.PAYMENTS_OPEN || 'private').toLowerCase() === 'public') return true;
  const list = (process.env.TRON_PAYER_ALLOWLIST || '')
    .split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(from || '').toLowerCase());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = String((req.query && req.query.action) || '');

  /* ---------- create ---------- */
  if (action === 'create') {
    const { tier, chain: chainId } = req.body || {};
    if (!TIERS[tier]) return res.status(400).json({ ok: false, error: 'bad_tier' });
    const chain = getChain(String(chainId || ''));
    if (!chain) return res.status(400).json({ ok: false, error: 'unknown_chain' });

    const usd = TIERS[tier].price + TIERS[tier].minTopup;
    const order = {
      ref: makeRef(),
      tier,
      chain: chain.id,
      address: chain.address,
      amount: uniqueAmount(usd),
      baseAmount: usd,
      createdAt: Date.now(),
      status: 'pending'
    };

    // remember where to start scanning so an older transfer is never matched
    if (chain.kind === 'evm') {
      try {
        order.startBlock = Number(BigInt(await rpc(chain.rpcs, 'eth_blockNumber', [])));
      } catch { /* fall back to the rolling window */ }
    }

    try {
      await saveOrder(order);
    } catch (err) {
      console.error('order create failed:', err.message);
      return res.status(500).json({ ok: false, error: 'storage_error' });
    }

    return res.status(200).json({
      ok: true,
      ref: order.ref,
      amount: order.amount,
      address: order.address,
      chain: chain.id,
      expiresAt: order.createdAt + ORDER_TTL_MS
    });
  }

  /* ---------- status ---------- */
  if (action === 'status') {
    const ref = String((req.query && req.query.ref) || '');
    if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: 'bad_ref' });

    const order = await loadOrder(ref);
    if (!order) return res.status(404).json({ ok: false, error: 'unknown_order' });
    if (order.status === 'paid') {
      return res.status(200).json({ ok: true, status: 'paid', tier: order.tier, txid: order.txid });
    }
    if (Date.now() - order.createdAt > ORDER_TTL_MS) {
      return res.status(200).json({ ok: true, status: 'expired' });
    }

    const chain = getChain(order.chain);
    if (!chain) return res.status(400).json({ ok: false, error: 'unknown_chain' });

    let hit;
    try {
      hit = await findPayment(chain, order);
    } catch (err) {
      console.error('watch failed:', order.chain, err.message);
      return res.status(200).json({ ok: true, status: 'pending', note: 'chain_busy' });
    }

    if (!hit) return res.status(200).json({ ok: true, status: 'pending' });
    if (!hit.confirmed) {
      return res.status(200).json({ ok: true, status: 'confirming', confirmations: hit.confirmations });
    }
    if (!allowedPayer(hit.from)) {
      return res.status(200).json({ ok: false, status: 'not_allowed' });
    }

    // claim the transaction; a fixed pathname makes a second claim impossible
    try {
      await put(`orders/${chain.id}-${hit.txid}.json`, JSON.stringify({
        txid: hit.txid, chain: chain.id, tier: order.tier, ref: order.ref,
        from: hit.from, amount: hit.amount, at: new Date().toISOString()
      }), { access: 'private', addRandomSuffix: false, contentType: 'application/json' });
    } catch (err) {
      if (/exists|conflict/i.test(err.message || '')) {
        return res.status(200).json({ ok: false, status: 'already_used' });
      }
      console.error('order claim failed:', err.message);
      return res.status(500).json({ ok: false, error: 'storage_error' });
    }

    order.status = 'paid';
    order.txid = hit.txid;
    order.from = hit.from;
    await saveOrder(order).catch(() => {});

    return res.status(200).json({ ok: true, status: 'paid', tier: order.tier, txid: hit.txid });
  }

  return res.status(400).json({ ok: false, error: 'unknown_action' });
}
