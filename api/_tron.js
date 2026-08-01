/* Trivex — shared TRON helpers for the serverless endpoints. */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const TIERS = {
  lite:     { price: 0,   minTopup: 10 },
  plus:     { price: 15,  minTopup: 10 },
  platinum: { price: 49,  minTopup: 10 },
  black:    { price: 199, minTopup: 10 }
};

/* base58check → hex payload (41 + 20 bytes), checksum stripped */
export function base58ToHex(addr) {
  if (typeof addr !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return null;
  let num = 0n;
  for (const ch of addr) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    num = num * 58n + BigInt(i);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const payload = hex.slice(0, -8).toLowerCase();
  return payload.length === 42 && payload.startsWith('41') ? payload : null;
}

export function tronBase() {
  return (process.env.TRON_NETWORK || 'nile') === 'mainnet'
    ? 'https://api.trongrid.io'
    : 'https://nile.trongrid.io';
}

export async function tronPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.TRON_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRON_API_KEY;
  const r = await fetch(`${tronBase()}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`tron_${r.status}`);
  return r.json();
}

/* ABI-encode transfer(address,uint256) arguments for a TRC-20 call */
export function encodeTransferParams(toBase58, amountSun) {
  const toHex = base58ToHex(toBase58);
  if (!toHex) return null;
  const addrArg = '0'.repeat(22) + toHex;               // 41 + 20 bytes, left-padded
  const amtArg = BigInt(amountSun).toString(16).padStart(64, '0');
  return addrArg + amtArg;
}

export function tierAmountSun(tier) {
  const t = TIERS[tier];
  return t ? Math.round((t.price + t.minTopup) * 1e6) : null;
}
