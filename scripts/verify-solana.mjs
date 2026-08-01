/* Checks the Solana SPL verifier against a real USDT transfer.
   Run: node scripts/verify-solana.mjs */

import { solRpc, verifySplTransfer } from '../api/_solana.js';

const chain = {
  id: 'solana', kind: 'solana',
  rpcs: ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'],
  token: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  decimals: 6
};

/* walk recent USDT activity until we find a transfer we can assert on */
const sigs = await solRpc(chain.rpcs, 'getSignaturesForAddress', [chain.token, { limit: 12 }]);

let found = null;
for (const s of sigs) {
  if (s.err) continue;
  const tx = await solRpc(chain.rpcs, 'getTransaction', [
    s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' }
  ]);
  if (!tx || !tx.meta) continue;
  const post = tx.meta.postTokenBalances || [];
  const pre = tx.meta.preTokenBalances || [];
  for (const b of post) {
    if (b.mint !== chain.token || !b.owner) continue;
    const before = pre.filter(p => p.owner === b.owner && p.mint === chain.token)
      .reduce((s, p) => s + Number(p.uiTokenAmount.uiAmount || 0), 0);
    const after = post.filter(p => p.owner === b.owner && p.mint === chain.token)
      .reduce((s, p) => s + Number(p.uiTokenAmount.uiAmount || 0), 0);
    if (after - before > 0.5) { found = { sig: s.signature, owner: b.owner, delta: after - before }; break; }
  }
  if (found) break;
}

if (!found) {
  console.log('no suitable sample transfer found in the last signatures — try again');
  process.exit(0);
}

console.log('sample tx :', found.sig);
console.log('recipient :', found.owner);
console.log('received  :', found.delta, 'USDT');

let failed = 0;
const ok = await verifySplTransfer({ ...chain, address: found.owner }, found.sig, 0.5);
console.log(`${ok.status === 'confirmed' ? 'PASS' : 'FAIL'}  correct recipient -> ${ok.status} (from ${ok.from})`);
if (ok.status !== 'confirmed') failed++;

const wrong = await verifySplTransfer(
  { ...chain, address: '11111111111111111111111111111111' }, found.sig, 0.5);
console.log(`${wrong.status === 'wrong_recipient' ? 'PASS' : 'FAIL'}  wrong recipient  -> ${wrong.status}`);
if (wrong.status !== 'wrong_recipient') failed++;

const under = await verifySplTransfer({ ...chain, address: found.owner }, found.sig, found.delta * 1000);
console.log(`${under.status === 'underpaid' ? 'PASS' : 'FAIL'}  underpaid        -> ${under.status}`);
if (under.status !== 'underpaid') failed++;

console.log(failed ? `\n${failed} check(s) failed` : '\nsolana verifier behaves correctly');
process.exit(failed ? 1 : 0);
