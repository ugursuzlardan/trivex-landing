/* Trivex — build / broadcast TRON transactions and read balances server-side.

   The browser cannot run TronWeb (its dist needs Node's Buffer), so wallets
   connected over WalletConnect get their unsigned transfer built here, sign it
   in the wallet, and hand the signed payload back for broadcast. */

import { tronPost, base58ToHex, encodeTransferParams, tierAmountSun, TIERS } from './_tron.js';

const ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const action = String((req.query && req.query.action) || '');
  const usdt = process.env.TRON_USDT_CONTRACT;
  const receiver = process.env.TRON_RECEIVING_ADDRESS;
  if (!usdt || !receiver) {
    return res.status(503).json({ ok: false, error: 'payment_not_configured' });
  }

  try {
    /* ---- balances: USDT (TRC-20) + TRX for the network fee ---- */
    if (action === 'balance') {
      const address = String((req.query && req.query.address) || '');
      if (!ADDR_RE.test(address)) {
        return res.status(400).json({ ok: false, error: 'bad_address' });
      }
      const [acc, call] = await Promise.all([
        tronPost('/wallet/getaccount', { address, visible: true }),
        tronPost('/wallet/triggerconstantcontract', {
          owner_address: address,
          contract_address: usdt,
          function_selector: 'balanceOf(address)',
          parameter: '0'.repeat(22) + base58ToHex(address),
          visible: true
        })
      ]);
      const hex = (call && call.constant_result && call.constant_result[0]) || '0';
      return res.status(200).json({
        ok: true,
        usdt: Number(BigInt('0x' + hex)) / 1e6,
        trx: Number((acc && acc.balance) || 0) / 1e6
      });
    }

    /* ---- build an unsigned USDT transfer for the connected wallet ---- */
    if (action === 'build') {
      const { from, tier } = req.body || {};
      if (!ADDR_RE.test(String(from || '')) || !TIERS[tier]) {
        return res.status(400).json({ ok: false, error: 'bad_request' });
      }
      const parameter = encodeTransferParams(receiver, tierAmountSun(tier));
      if (!parameter) return res.status(500).json({ ok: false, error: 'encode_failed' });

      const built = await tronPost('/wallet/triggersmartcontract', {
        owner_address: from,
        contract_address: usdt,
        function_selector: 'transfer(address,uint256)',
        parameter,
        fee_limit: 100000000,
        call_value: 0,
        visible: true
      });
      if (!built || !built.transaction || (built.result && built.result.result === false)) {
        return res.status(502).json({
          ok: false, error: 'build_failed',
          detail: (built && built.result && built.result.message) || null
        });
      }
      return res.status(200).json({ ok: true, transaction: built.transaction });
    }

    /* ---- broadcast the wallet-signed transaction ---- */
    if (action === 'broadcast') {
      const { transaction } = req.body || {};
      if (!transaction || typeof transaction !== 'object' || !transaction.txID) {
        return res.status(400).json({ ok: false, error: 'bad_request' });
      }
      const out = await tronPost('/wallet/broadcasttransaction', transaction);
      if (!out || out.result !== true) {
        return res.status(200).json({
          ok: false, error: 'broadcast_failed',
          code: (out && out.code) || null
        });
      }
      return res.status(200).json({ ok: true, txid: transaction.txID });
    }

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    console.error('tron-tx failed:', action, err.message);
    return res.status(502).json({ ok: false, error: 'chain_unavailable' });
  }
}
