/* Trivex — TRON wallet adapters (TronLink, Trust, WalletConnect).

   These are TRON's own adapters, so a session only ever asks for the TRON
   namespace — the multi-namespace proposal that made wallets answer "some of
   the required chains are not supported yet" cannot happen here.

   Trust Wallet is best driven from inside its own dApp browser, where it
   injects window.trustwallet.tronLink and signs without any relay. When the
   page is opened in an outside browser we send the customer into that dApp
   browser instead of negotiating a remote session. */

(function () {
  const CDN = 'https://esm.sh';
  const DEPS = '?bundle&deps=@noble/hashes@1.8.0';
  const PROJECT_ID = 'dff67a76430e884635ae5d3c113e1c05';
  const SITE = 'https://trivex-landing.vercel.app/activate.html';

  const adapters = {};

  async function make(kind, network) {
    if (adapters[kind]) return adapters[kind];
    let a;
    if (kind === 'tronlink') {
      const m = await import(`${CDN}/@tronweb3/tronwallet-adapter-tronlink@1${DEPS}`);
      a = new m.TronLinkAdapter();
    } else if (kind === 'trust') {
      const m = await import(`${CDN}/@tronweb3/tronwallet-adapter-trust@1${DEPS}`);
      a = new m.TrustAdapter();
    } else {
      const m = await import(`${CDN}/@tronweb3/tronwallet-adapter-walletconnect@2${DEPS}`);
      a = new m.WalletConnectAdapter({
        network: network === 'mainnet' ? 'Mainnet' : 'Nile',
        options: {
          projectId: PROJECT_ID,
          metadata: {
            name: 'Trivex',
            description: 'USDT card activation',
            url: location.origin,
            icons: [location.origin + '/icon.png']
          }
        }
      });
    }
    adapters[kind] = a;
    return a;
  }

  /* is Trust injecting its TRON provider on this page? */
  function trustInjected() {
    return !!(window.trustwallet && window.trustwallet.tronLink);
  }

  window.TrivexTron = {
    trustInjected,

    /* open this page inside Trust's dApp browser, where signing just works */
    openInTrust(extraParams) {
      const url = new URL(SITE);
      const cur = new URLSearchParams(location.search);
      cur.forEach((v, k) => url.searchParams.set(k, v));
      Object.entries(extraParams || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      location.href = 'https://link.trustwallet.com/open_url?coin_id=195&url=' +
        encodeURIComponent(url.toString());
    },

    async connect(kind, network) {
      const a = await make(kind, network);
      await a.connect();
      if (!a.address) throw new Error('no_address');
      return a.address;
    },

    async signMessage(kind, message) {
      const a = adapters[kind];
      if (!a) throw new Error('not_connected');
      return a.signMessage(message);
    },

    async signTransaction(kind, unsignedTx) {
      const a = adapters[kind];
      if (!a) throw new Error('not_connected');
      return a.signTransaction(unsignedTx);
    },

    /* deep link used to bring the wallet forward for an approval */
    walletLink(kind) {
      return kind === 'trust' ? 'trust://' : null;
    }
  };
})();
