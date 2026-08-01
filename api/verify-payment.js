/* Trivex — on-chain payment verification (TRON, USDT TRC-20).

   The client submits the txid of its signed transfer. We fetch that exact
   transaction and check it ourselves: right contract, right recipient, right
   amount, succeeded, and buried deep enough to be final. Looking the txid up
   directly (rather than scanning the receiving account's recent transfers)
   keeps verification correct once traffic outgrows a single page of history.

   put() with a fixed pathname refuses to overwrite, which doubles as replay
   protection: one txid can only ever create one order. */

import { put } from '@vercel/blob';
import { getChain } from './_chains.js';
import { verifyErc20Transfer, TX_HASH_RE } from './_evm.js';

const TIERS = {
  lite:     { price: 0,   minTopup: 10 },
  plus:     { price: 15,  minTopup: 10 },
  platinum: { price: 49,  minTopup: 10 },
  black:    { price: 199, minTopup: 10 }
};

const TXID_RE = /^[0-9a-f]{64}$/i;
const TRANSFER_SELECTOR = 'a9059cbb';
const MIN_CONFIRMATIONS = 19; // TRON is irreversible past one SR round
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/* base58check → hex payload (41 + 20 bytes), no checksum */
function base58ToHex(addr) {
  let num = 0n;
  for (const ch of addr) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    num = num * 58n + BigInt(i);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hex.slice(0, -8).toLowerCase(); // strip 4-byte checksum
}

async function tronPost(base, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.TRON_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRON_API_KEY;
  const r = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`tron_${r.status}`);
  return r.json();
}

/* order bookkeeping shared by every chain */
async function recordOrder(order) {
  try {
    await put(`orders/${order.chain}-${order.txid}.json`, JSON.stringify(order), {
      access: 'private', addRandomSuffix: false, contentType: 'application/json'
    });
    return { ok: true };
  } catch (err) {
    // fixed pathname + no overwrite → a second claim of the same tx lands here
    if (/exists|conflict/i.test(err.message || '')) return { ok: false, status: 'already_used' };
    console.error('order store failed:', err.message);
    return { ok: false, status: 'storage_error' };
  }
}

function allowedPayer(from) {
  if ((process.env.PAYMENTS_OPEN || 'private').toLowerCase() === 'public') return true;
  const list = (process.env.TRON_PAYER_ALLOWLIST || '')
    .split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(from || '').toLowerCase());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const { txid, tier, chain: chainId } = req.query || {};
  if (!tier || !TIERS[tier]) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }

  /* ---- EVM chains (BNB, Ethereum, Polygon, Arbitrum) ---- */
  if (chainId && chainId !== 'tron') {
    const chain = getChain(chainId);
    if (!chain || chain.kind !== 'evm') {
      return res.status(400).json({ ok: false, error: 'unknown_chain' });
    }
    const hash = String(txid || '');
    if (!TX_HASH_RE.test(hash)) {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    const expectedUnits =
      BigInt(TIERS[tier].price + TIERS[tier].minTopup) * 10n ** BigInt(chain.decimals);
    const out = await verifyErc20Transfer(chain, hash.toLowerCase(), expectedUnits);

    if (out.status === 'chain_unavailable') {
      return res.status(502).json({ ok: false, error: 'chain_unavailable' });
    }
    if (out.status !== 'confirmed') {
      return res.status(200).json({ ok: out.status === 'pending', ...out });
    }
    if (!allowedPayer(out.from)) {
      return res.status(200).json({ ok: false, status: 'not_allowed' });
    }

    const stored = await recordOrder({
      txid: hash.toLowerCase(), chain: chain.id, tier,
      from: out.from, amount: out.amount, block: out.block,
      at: new Date().toISOString()
    });
    if (!stored.ok) {
      return stored.status === 'already_used'
        ? res.status(200).json({ ok: false, status: 'already_used' })
        : res.status(500).json({ ok: false, error: 'storage_error' });
    }
    return res.status(200).json({ ok: true, status: 'confirmed', tier, chain: chain.id });
  }

  /* ---- TRON ---- */
  if (!txid || !TXID_RE.test(txid)) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }

  const network = process.env.TRON_NETWORK || 'nile';
  const address = process.env.TRON_RECEIVING_ADDRESS;
  const usdtContract = process.env.TRON_USDT_CONTRACT;
  if (!address || !usdtContract) {
    return res.status(503).json({ ok: false, error: 'payment_not_configured' });
  }

  const base = network === 'mainnet' ? 'https://api.trongrid.io' : 'https://nile.trongrid.io';
  const expected = BigInt(Math.round((TIERS[tier].price + TIERS[tier].minTopup) * 1e6));
  const id = txid.toLowerCase();

  let tx, info, now;
  try {
    tx = await tronPost(base, '/wallet/gettransactionbyid', { value: id, visible: true });
  } catch (err) {
    console.error('trongrid tx lookup failed:', err.message);
    return res.status(502).json({ ok: false, error: 'chain_unavailable' });
  }

  // unknown txid yet — still propagating
  if (!tx || !tx.raw_data) {
    return res.status(200).json({ ok: true, status: 'pending' });
  }

  const ret = (tx.ret && tx.ret[0] && tx.ret[0].contractRet) || '';
  if (ret && ret !== 'SUCCESS') {
    return res.status(200).json({ ok: false, status: 'failed', reason: ret });
  }

  const contract = tx.raw_data.contract && tx.raw_data.contract[0];
  const val = contract && contract.parameter && contract.parameter.value;
  if (!val || contract.type !== 'TriggerSmartContract') {
    return res.status(200).json({ ok: false, status: 'wrong_tx' });
  }
  if (val.contract_address !== usdtContract) {
    return res.status(200).json({ ok: false, status: 'wrong_token' });
  }

  const data = String(val.data || '').toLowerCase();
  if (!data.startsWith(TRANSFER_SELECTOR) || data.length < 8 + 128) {
    return res.status(200).json({ ok: false, status: 'wrong_tx' });
  }
  const toHex = data.slice(8 + 64 - 42, 8 + 64);          // last 21 bytes of arg 1
  const amount = BigInt('0x' + data.slice(8 + 64, 8 + 128));
  const expectedToHex = base58ToHex(address);

  if (!expectedToHex || toHex !== expectedToHex) {
    return res.status(200).json({ ok: false, status: 'wrong_recipient' });
  }
  if (amount < expected) {
    return res.status(200).json({ ok: false, status: 'underpaid', expected: expected.toString() });
  }

  if (!allowedPayer(val.owner_address)) {
    return res.status(200).json({ ok: false, status: 'not_allowed' });
  }

  // must be mined, successful, and final
  try {
    info = await tronPost(base, '/wallet/gettransactioninfobyid', { value: id });
    now = await tronPost(base, '/wallet/getnowblock', {});
  } catch (err) {
    console.error('trongrid receipt lookup failed:', err.message);
    return res.status(502).json({ ok: false, error: 'chain_unavailable' });
  }

  if (!info || info.blockNumber === undefined) {
    return res.status(200).json({ ok: true, status: 'pending' });
  }
  const receipt = (info.receipt && info.receipt.result) || '';
  if (receipt && receipt !== 'SUCCESS') {
    return res.status(200).json({ ok: false, status: 'failed', reason: receipt });
  }
  const head = (now && now.block_header && now.block_header.raw_data &&
                now.block_header.raw_data.number) || 0;
  if (head - info.blockNumber < MIN_CONFIRMATIONS) {
    return res.status(200).json({ ok: true, status: 'pending', confirmations: head - info.blockNumber });
  }

  const stored = await recordOrder({
    txid: id,
    chain: 'tron',
    tier,
    from: val.owner_address,
    amount: amount.toString(),
    network,
    block: info.blockNumber,
    at: new Date().toISOString()
  });
  if (!stored.ok) {
    return stored.status === 'already_used'
      ? res.status(200).json({ ok: false, status: 'already_used' })
      : res.status(500).json({ ok: false, error: 'storage_error' });
  }

  return res.status(200).json({ ok: true, status: 'confirmed', tier, chain: 'tron' });
}
