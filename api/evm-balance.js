/* Trivex — USDT + native-coin balance on an EVM chain, used for the
   pre-flight checks before a customer signs anything. */

import { getChain } from './_chains.js';
import { erc20Balance, nativeBalance, EVM_ADDR_RE } from './_evm.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const { chain: chainId, address } = req.query || {};
  const chain = getChain(String(chainId || ''));
  if (!chain || chain.kind !== 'evm') {
    return res.status(400).json({ ok: false, error: 'unknown_chain' });
  }
  if (!EVM_ADDR_RE.test(String(address || ''))) {
    return res.status(400).json({ ok: false, error: 'bad_address' });
  }

  try {
    const [token, native] = await Promise.all([
      erc20Balance(chain, address),
      nativeBalance(chain, address)
    ]);
    return res.status(200).json({
      ok: true,
      usdt: Number(token) / 10 ** chain.decimals,
      native: Number(native) / 1e18,
      symbol: chain.short
    });
  } catch (err) {
    console.error('evm-balance failed:', chain.id, err.message);
    return res.status(502).json({ ok: false, error: 'chain_unavailable' });
  }
}
