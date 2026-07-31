/* Trivex — public payment config (network, receiving address, USDT contract).
   Values come from Vercel env vars so mainnet switch is config-only. */

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const network = process.env.TRON_NETWORK || 'nile';
  const address = process.env.TRON_RECEIVING_ADDRESS || null;
  const usdtContract = process.env.TRON_USDT_CONTRACT || null;

  if (!address || !usdtContract) {
    return res.status(503).json({ ok: false, error: 'payment_not_configured' });
  }

  return res.status(200).json({
    ok: true,
    network,                          // 'nile' (testnet) | 'mainnet'
    mode: network === 'mainnet' ? 'live' : 'testnet',
    address,
    usdtContract
  });
}
