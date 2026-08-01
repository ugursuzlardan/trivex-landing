/* Proves the automatic payment finder locates a real transfer by amount alone.
   Run: node scripts/verify-watch.mjs */

import { findPayment } from '../api/_watch.js';

let failed = 0;

/* ---- TRON: the operator's real 10 USDT activation payment ---- */
const tron = {
  id: 'tron', kind: 'tron',
  address: 'TUZpJ3VEKErnUDP1iULwigUNFAApnyb78Z',
  token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  decimals: 6, minConfirmations: 19
};
const KNOWN_TXID = 'f570fa8f16c9562d7402a3e2b5014eeda18e7f833fabb8d8c27a84569e0ab654';
const KNOWN_TIME = Date.parse('2026-07-31T02:50:00Z');

const hit = await findPayment(tron, { amount: 10, createdAt: KNOWN_TIME });
const tronOk = hit && hit.txid === KNOWN_TXID;
console.log(`${tronOk ? 'PASS' : 'FAIL'}  tron: finds the 10 USDT payment by amount`);
if (hit) console.log(`      txid=${hit.txid.slice(0, 16)}… from=${hit.from} amount=${hit.amount}`);
if (!tronOk) failed++;

/* a different amount must not match */
const miss = await findPayment(tron, { amount: 7.77, createdAt: KNOWN_TIME });
console.log(`${miss === null ? 'PASS' : 'FAIL'}  tron: ignores an amount nobody sent`);
if (miss !== null) failed++;

/* ---- EVM: scan BNB Chain for a recent transfer we pick ourselves ---- */
const bsc = {
  id: 'bsc', kind: 'evm',
  rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.bnbchain.org'],
  token: '0x55d398326f99059fF775485246999027B3197955',
  decimals: 18, minConfirmations: 15, scanBlocks: 300
};
const { rpc } = await import('../api/_evm.js');
const head = BigInt(await rpc(bsc.rpcs, 'eth_blockNumber', []));
let sample = null;
for (let back = 30n; back < 60n && !sample; back++) {
  const blk = '0x' + (head - back).toString(16);
  const logs = await rpc(bsc.rpcs, 'eth_getLogs', [{
    fromBlock: blk, toBlock: blk, address: bsc.token,
    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
  }]);
  const big = logs.find(l => BigInt(l.data) > 10n ** 18n);
  if (big) sample = big;
}

if (sample) {
  const to = '0x' + sample.topics[2].slice(-40);
  const amount = Number(BigInt(sample.data)) / 1e18;
  const found = await findPayment({ ...bsc, address: to }, { amount, createdAt: Date.now(), startBlock: Number(head - 60n) });
  const evmOk = found && found.txid.toLowerCase() === sample.transactionHash.toLowerCase();
  console.log(`${evmOk ? 'PASS' : 'FAIL'}  bsc:  finds a ${amount.toFixed(4)} USDT transfer by amount`);
  if (!evmOk) failed++;
} else {
  console.log('SKIP  bsc:  no sample transfer in the scanned range');
}

console.log(failed ? `\n${failed} check(s) failed` : '\npayment watcher works on tron and evm');
process.exit(failed ? 1 : 0);
