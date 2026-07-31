/* Trivex — WalletConnect v2 bridge (TRON namespace).
   Loads the official TRON wallet adapter on demand (esm.sh bundle) and
   exposes a tiny API used by activate.js. The projectId is a public
   identifier (safe to ship in frontend code). */

(function () {
  const PROJECT_ID = 'dff67a76430e884635ae5d3c113e1c05';

  let AdapterClass = null;
  let adapter = null;

  async function load() {
    if (AdapterClass) return;
    const mod = await import('https://esm.sh/@tronweb3/tronwallet-adapter-walletconnect@2?bundle&deps=@noble/hashes@1.8.0');
    AdapterClass = mod.WalletConnectAdapter;
  }

  function getAdapter(network) {
    if (!adapter) {
      adapter = new AdapterClass({
        network: network === 'mainnet' ? 'Mainnet' : 'Nile',
        options: {
          projectId: PROJECT_ID,
          metadata: {
            name: 'Trivex',
            description: 'USDT TRC-20 card activation',
            url: 'https://trivex-landing.vercel.app',
            icons: ['https://trivex-landing.vercel.app/icon.png']
          }
        }
      });
    }
    return adapter;
  }

  window.TrivexWC = {
    /* opens the WalletConnect modal (QR / wallet list); resolves to the
       connected TRON address */
    async connect(network) {
      await load();
      const a = getAdapter(network);
      await a.connect();
      if (!a.address) throw new Error('wc_no_address');
      return a.address;
    },
    /* asks the connected wallet to sign an unsigned TRON transaction */
    async signTransaction(unsignedTx) {
      if (!adapter) throw new Error('wc_not_connected');
      return adapter.signTransaction(unsignedTx);
    },
    async disconnect() {
      if (adapter) { try { await adapter.disconnect(); } catch { /* noop */ } }
    }
  };
})();
