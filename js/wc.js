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

  /* WalletConnect sessions carry the wallet's own deep link. After a request
     is sent the browser must bring that app to the foreground, otherwise the
     approval screen sits unseen inside the wallet. */
  function sessionRedirect() {
    try {
      const w = adapter && adapter._wallet;
      const sessions = [];
      if (w) {
        if (w.session) sessions.push(w.session);
        if (w.signer && w.signer.session) sessions.push(w.signer.session);
        if (w.client && w.client.session && typeof w.client.session.getAll === 'function') {
          sessions.push(...w.client.session.getAll());
        }
      }
      for (const s of sessions) {
        const r = s && s.peer && s.peer.metadata && s.peer.metadata.redirect;
        if (r && (r.native || r.universal)) return r;
      }
    } catch { /* metadata is optional */ }
    return null;
  }

  window.TrivexWC = {
    /* deep link that reopens the connected wallet app */
    walletLink() {
      const r = sessionRedirect();
      return r ? (r.native || r.universal) : null;
    },
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
    /* asks the wallet to sign a plain-text message — the wallet shows the text
       to the user, which is how the order terms reach the approval screen */
    async signMessage(message) {
      if (!adapter) throw new Error('wc_not_connected');
      return adapter.signMessage(message);
    },
    async disconnect() {
      if (adapter) { try { await adapter.disconnect(); } catch { /* noop */ } }
    }
  };
})();
