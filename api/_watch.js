/* Trivex — find an incoming payment without being told its hash.

   Every chain is scanned for transfers of the order's exact amount into the
   receiving address after the order was created. This is what makes exchange
   withdrawals work: the customer just sends, and the order completes. */

import { rpc } from './_evm.js';
import { solRpc } from './_solana.js';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const near = (a, b) => Math.abs(a - b) < 1e-6;

/* ---------- EVM ---------- */
async function watchEvm(chain, order) {
  const head = BigInt(await rpc(chain.rpcs, 'eth_blockNumber', []));
  const topic = '0x' + chain.address.toLowerCase().replace(/^0x/, '').padStart(64, '0');

  // start where the order did, but never ask for more history than public
  // RPCs allow — and if one still refuses, narrow the window and retry
  const start = order.startBlock ? BigInt(order.startBlock) : 0n;
  let span = BigInt(chain.scanBlocks || 900);
  let logs = null;

  for (let attempt = 0; attempt < 3 && logs === null; attempt++) {
    const floor = head > span ? head - span : 0n;
    const from = start > floor ? start : floor;
    try {
      logs = await rpc(chain.rpcs, 'eth_getLogs', [{
        fromBlock: '0x' + from.toString(16),
        toBlock: 'latest',
        address: chain.token,
        topics: [TRANSFER_TOPIC, null, topic]
      }]);
    } catch (err) {
      if (!/range|limit|exceed|large|many/i.test(err.message || '')) throw err;
      span = span / 4n > 50n ? span / 4n : 50n;
    }
  }
  if (logs === null) return null;

  const want = order.amount;
  for (const log of logs.reverse()) {
    const value = Number(BigInt(log.data || '0x0')) / 10 ** chain.decimals;
    if (!near(value, want)) continue;
    const receipt = await rpc(chain.rpcs, 'eth_getTransactionReceipt', [log.transactionHash]);
    if (!receipt || receipt.status !== '0x1') continue;
    const confirmations = Number(head - BigInt(receipt.blockNumber));
    return {
      txid: log.transactionHash,
      from: '0x' + (log.topics[1] || '').slice(-40),
      amount: value,
      confirmations,
      confirmed: confirmations >= chain.minConfirmations
    };
  }
  return null;
}

/* ---------- TRON ---------- */
async function watchTron(chain, order) {
  const headers = { accept: 'application/json' };
  if (process.env.TRON_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRON_API_KEY;

  const url = `https://api.trongrid.io/v1/accounts/${chain.address}/transactions/trc20` +
    `?only_confirmed=true&only_to=true&limit=50&contract_address=${chain.token}` +
    `&min_timestamp=${order.createdAt - 5 * 60 * 1000}`;

  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`trongrid_${r.status}`);
  const data = (await r.json()).data || [];

  for (const t of data) {
    const value = Number(t.value) / 10 ** chain.decimals;
    if (!near(value, order.amount)) continue;
    return {
      txid: t.transaction_id,
      from: t.from,
      amount: value,
      confirmations: chain.minConfirmations,   // endpoint only returns confirmed
      confirmed: true
    };
  }
  return null;
}

/* ---------- Solana ---------- */
async function watchSolana(chain, order) {
  const accounts = await solRpc(chain.rpcs, 'getTokenAccountsByOwner', [
    chain.address, { mint: chain.token }, { encoding: 'jsonParsed' }
  ]);
  const ata = accounts && accounts.value && accounts.value[0] && accounts.value[0].pubkey;
  if (!ata) return null;                       // no token account yet → no payments

  const sigs = await solRpc(chain.rpcs, 'getSignaturesForAddress', [ata, { limit: 25 }]);
  for (const s of sigs) {
    if (s.err) continue;
    if (s.blockTime && s.blockTime * 1000 < order.createdAt - 5 * 60 * 1000) break;

    const tx = await solRpc(chain.rpcs, 'getTransaction', [
      s.signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' }
    ]);
    if (!tx || !tx.meta || tx.meta.err) continue;

    const mine = b => b.owner === chain.address && b.mint === chain.token;
    const sum = arr => (arr || []).filter(mine)
      .reduce((n, b) => n + Number(b.uiTokenAmount.uiAmount || 0), 0);
    const received = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    if (!near(received, order.amount)) continue;

    const from = (tx.transaction.message.accountKeys.find(k => k.signer) || {}).pubkey || null;
    return { txid: s.signature, from, amount: received, confirmations: 1, confirmed: true };
  }
  return null;
}

export async function findPayment(chain, order) {
  if (chain.kind === 'evm') return watchEvm(chain, order);
  if (chain.kind === 'tron') return watchTron(chain, order);
  if (chain.kind === 'solana') return watchSolana(chain, order);
  return null;
}
