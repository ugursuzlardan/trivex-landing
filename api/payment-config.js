/* Trivex — public payment config: which chains customers can pay from. */

import { enabledChains } from './_chains.js';
import { TIERS } from './_tron.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const network = process.env.TRON_NETWORK || 'nile';
  const chains = enabledChains();
  if (!chains.length) {
    return res.status(503).json({ ok: false, error: 'payment_not_configured' });
  }

  return res.status(200).json({
    ok: true,
    network,                                      // TRON network of record
    mode: network === 'mainnet' ? 'live' : 'testnet',
    paymentsOpen: (process.env.PAYMENTS_OPEN || 'private').toLowerCase() === 'public',
    tiers: TIERS,
    chains: chains.map(c => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      short: c.short,
      address: c.address,
      token: c.token,
      decimals: c.decimals,
      chainId: c.chainId || null,
      chainIdHex: c.chainIdHex || null,
      rpcs: c.rpcs || null,
      nativeCurrency: c.nativeCurrency || null,
      explorer: c.explorer || null
    })),

    // kept for the existing TRON client code
    address: (chains.find(c => c.id === 'tron') || {}).address || null,
    usdtContract: (chains.find(c => c.id === 'tron') || {}).token || null
  });
}
