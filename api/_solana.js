/* Trivex — Solana helpers.

   SPL tokens are not held on the wallet address itself but in token accounts
   owned by it, so a transfer is confirmed by comparing the pre/post token
   balances of the receiving owner inside the transaction, rather than by
   reading a transfer log. */

export const SOL_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
export const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function solRpc(urls, method, params) {
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr = null;
  for (const url of list) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'trivex/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      });
      if (!r.ok) { lastErr = new Error(`rpc_${r.status}`); continue; }
      const out = await r.json();
      if (out.error) { lastErr = new Error(out.error.message || 'rpc_error'); continue; }
      return out.result;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('rpc_unavailable');
}

/* total USDT held by `owner` across its token accounts */
export async function splBalance(chain, owner) {
  const res = await solRpc(chain.rpcs, 'getTokenAccountsByOwner', [
    owner, { mint: chain.token }, { encoding: 'jsonParsed' }
  ]);
  let total = 0;
  for (const acc of (res && res.value) || []) {
    const amt = acc.account.data.parsed.info.tokenAmount;
    total += Number(amt.uiAmount || 0);
  }
  return total;
}

export async function solBalance(chain, owner) {
  const res = await solRpc(chain.rpcs, 'getBalance', [owner]);
  return Number((res && res.value) || 0) / 1e9;
}

/* Confirm that `signature` moved at least `expectedUi` USDT to chain.address */
export async function verifySplTransfer(chain, signature, expectedUi) {
  let tx;
  try {
    tx = await solRpc(chain.rpcs, 'getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' }
    ]);
  } catch {
    return { status: 'chain_unavailable' };
  }
  if (!tx) return { status: 'pending' };                      // unknown or not finalized
  if (tx.meta && tx.meta.err) return { status: 'failed', reason: 'reverted' };

  const pre = (tx.meta && tx.meta.preTokenBalances) || [];
  const post = (tx.meta && tx.meta.postTokenBalances) || [];
  const mine = b => b.owner === chain.address && b.mint === chain.token;

  const before = pre.filter(mine).reduce((s, b) => s + Number(b.uiTokenAmount.uiAmount || 0), 0);
  const after = post.filter(mine).reduce((s, b) => s + Number(b.uiTokenAmount.uiAmount || 0), 0);
  const received = after - before;

  if (!post.some(mine)) return { status: 'wrong_recipient' };
  if (received <= 0) return { status: 'wrong_recipient' };
  if (received + 1e-9 < expectedUi) {
    return { status: 'underpaid', expected: String(expectedUi) };
  }

  // payer: first signer of the transaction
  const from = (tx.transaction.message.accountKeys.find(k => k.signer) || {}).pubkey || null;

  return {
    status: 'confirmed',
    from,
    amount: String(Math.round(received * 10 ** chain.decimals)),
    block: tx.slot
  };
}
