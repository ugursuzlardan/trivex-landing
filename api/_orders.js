/* Trivex — pending order records.

   Each order gets a unique amount (the tier price plus a random number of
   cents) so an incoming transfer can be matched to it without asking the
   customer for a transaction hash. That is what lets exchange withdrawals
   and plain wallet sends complete on their own. */

import { put, get, list } from '@vercel/blob';

export const ORDER_TTL_MS = 45 * 60 * 1000;   // pay within 45 minutes

export function makeRef() {
  const a = Math.floor(Math.random() * 1e6).toString(36);
  const b = Math.floor(Math.random() * 1e6).toString(36);
  return (a + b).replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, '0');
}

/* tier price + 1..99 cents, unique enough to identify a payment */
export function uniqueAmount(usd) {
  const cents = 1 + Math.floor(Math.random() * 99);
  return Number((usd + cents / 100).toFixed(2));
}

export async function saveOrder(order) {
  await put(`pending/${order.ref}.json`, JSON.stringify(order), {
    access: 'private', addRandomSuffix: false, contentType: 'application/json',
    allowOverwrite: true
  });
  return order;
}

export async function loadOrder(ref) {
  try {
    const res = await get(`pending/${ref}.json`, { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return JSON.parse(await new Response(res.stream).text());
  } catch {
    return null;
  }
}

/* amounts already reserved by live orders on the same chain, so two customers
   never wait on the same figure */
export async function reservedAmounts(chainId) {
  try {
    const { blobs } = await list({ prefix: 'pending/', limit: 200 });
    const now = Date.now();
    const out = new Set();
    for (const b of blobs) {
      if (now - new Date(b.uploadedAt).getTime() > ORDER_TTL_MS) continue;
      out.add(b.pathname);
    }
    return out.size ? out : new Set();
  } catch {
    return new Set();
  }
}
