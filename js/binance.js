/* Trivex — Binance Web3 Wallet bridge (TRON).
   Uses the official TRON adapter, which talks to the Binance browser extension
   or the wallet inside the Binance app. Loaded on demand; when the wallet is
   not present the caller falls back to WalletConnect, where Binance is also
   registered. */

(function () {
  let Mod = null;
  let adapter = null;

  async function load() {
    if (Mod) return;
    Mod = await import('https://esm.sh/@tronweb3/tronwallet-adapter-binance@1?bundle&deps=@noble/hashes@1.8.0');
  }

  window.TrivexBinance = {
    /* is the Binance wallet injected in this browser / app? */
    async isSupported() {
      try {
        await load();
        return !!(Mod.supportBinanceWallet && Mod.supportBinanceWallet());
      } catch { return false; }
    },
    /* deep-link the page into the Binance app's dApp browser (mobile) */
    async openApp() {
      try { await load(); Mod.openBinanceWallet && Mod.openBinanceWallet(); } catch { /* noop */ }
    },
    async connect() {
      await load();
      if (!adapter) adapter = new Mod.BinanceWalletAdapter();
      await adapter.connect();
      if (!adapter.address) throw new Error('binance_no_address');
      return adapter.address;
    },
    /* deep link used to bring the Binance app forward for an approval */
    walletLink() { return 'bnc://'; },
    async signTransaction(unsignedTx) {
      if (!adapter) throw new Error('binance_not_connected');
      return adapter.signTransaction(unsignedTx);
    },
    async signMessage(message) {
      if (!adapter) throw new Error('binance_not_connected');
      return adapter.signMessage(message);
    }
  };
})();
