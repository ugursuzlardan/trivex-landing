/* Trivex — EVM helpers: JSON-RPC calls and ERC-20 transfer verification. */

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const TX_HASH_RE = /^0x[0-9a-f]{64}$/i;
export const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/* Public RPCs rate-limit without warning, so every call walks a list of
   endpoints and only fails once they all do. */
export async function rpc(urls, method, params) {
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
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('rpc_unavailable');
}

const pad = a => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

/* ERC-20 balanceOf */
export async function erc20Balance(chain, address) {
  const data = '0x70a08231' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const res = await rpc(chain.rpcs, 'eth_call', [{ to: chain.token, data }, 'latest']);
  return BigInt(res || '0x0');
}

/* native coin balance (for the gas warning) */
export async function nativeBalance(chain, address) {
  const res = await rpc(chain.rpcs, 'eth_getBalance', [address, 'latest']);
  return BigInt(res || '0x0');
}

/* calldata for transfer(address,uint256) */
export function transferCalldata(to, amount) {
  return '0xa9059cbb' +
    to.toLowerCase().replace(/^0x/, '').padStart(64, '0') +
    BigInt(amount).toString(16).padStart(64, '0');
}

/* Confirm an ERC-20 transfer of at least `expected` units to `chain.address`.
   Returns {status, ...} mirroring the TRON verifier's vocabulary. */
export async function verifyErc20Transfer(chain, txHash, expected) {
  let receipt;
  try {
    receipt = await rpc(chain.rpcs, 'eth_getTransactionReceipt', [txHash]);
  } catch {
    return { status: 'chain_unavailable' };
  }
  if (!receipt) return { status: 'pending' };               // not mined yet
  if (receipt.status !== '0x1') return { status: 'failed', reason: 'reverted' };

  const wantTo = pad(chain.address);
  const log = (receipt.logs || []).find(l =>
    (l.address || '').toLowerCase() === chain.token.toLowerCase() &&
    (l.topics || [])[0] === TRANSFER_TOPIC &&
    (l.topics || [])[2] === wantTo
  );
  if (!log) return { status: 'wrong_recipient' };

  const amount = BigInt(log.data || '0x0');
  if (amount < expected) {
    return { status: 'underpaid', expected: expected.toString() };
  }

  let head;
  try {
    head = BigInt(await rpc(chain.rpcs, 'eth_blockNumber', []));
  } catch {
    return { status: 'chain_unavailable' };
  }
  const confirmations = Number(head - BigInt(receipt.blockNumber));
  if (confirmations < chain.minConfirmations) {
    return { status: 'pending', confirmations };
  }

  const from = '0x' + (log.topics[1] || '').slice(-40);
  return {
    status: 'confirmed',
    from,
    amount: amount.toString(),
    block: Number(BigInt(receipt.blockNumber))
  };
}
