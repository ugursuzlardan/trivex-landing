/* Trivex — EVM wallets (MetaMask, Coinbase, Binance, OKX, Trust in-app…).

   Every EVM wallet exposes the same EIP-1193 provider, so one integration
   covers all of them. Unlike TRON, the wallet builds and broadcasts the
   transaction itself — we only supply the calldata. */

(function () {
  function provider() {
    const eth = window.ethereum;
    if (!eth) return null;
    // several extensions installed → prefer the one the user actually picked
    if (eth.providers && eth.providers.length) {
      return eth.providers.find(p => p.isMetaMask) || eth.providers[0];
    }
    return eth;
  }

  function calldata(to, amountUnits) {
    return '0xa9059cbb' +
      to.toLowerCase().replace(/^0x/, '').padStart(64, '0') +
      BigInt(amountUnits).toString(16).padStart(64, '0');
  }

  window.TrivexEVM = {
    isAvailable() { return !!provider(); },

    name() {
      const p = provider();
      if (!p) return null;
      if (p.isMetaMask) return 'MetaMask';
      if (p.isCoinbaseWallet) return 'Coinbase Wallet';
      if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
      if (p.isOkxWallet || window.okxwallet) return 'OKX Wallet';
      return 'Web3 Wallet';
    },

    async connect(chain) {
      const p = provider();
      if (!p) throw new Error('no_evm_provider');
      const accounts = await p.request({ method: 'eth_requestAccounts' });
      if (!accounts || !accounts.length) throw new Error('no_account');
      await this.switchChain(chain);
      return accounts[0];
    },

    /* ask the wallet to move to the chain the customer chose */
    async switchChain(chain) {
      const p = provider();
      try {
        await p.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chain.chainIdHex }]
        });
      } catch (err) {
        // 4902 = chain unknown to the wallet → offer to add it
        if (err && (err.code === 4902 || (err.data && err.data.originalError && err.data.originalError.code === 4902))) {
          await p.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chain.chainIdHex,
              chainName: chain.label,
              rpcUrls: chain.rpcs,
              nativeCurrency: chain.nativeCurrency,
              blockExplorerUrls: chain.explorer ? [chain.explorer] : undefined
            }]
          });
        } else if (err && err.code === 4001) {
          throw new Error('user_rejected');
        } else {
          throw err;
        }
      }
    },

    async currentChainId() {
      const p = provider();
      if (!p) return null;
      try { return await p.request({ method: 'eth_chainId' }); } catch { return null; }
    },

    /* wallets render this text on their approval screen */
    async signMessage(message, address) {
      const p = provider();
      const hex = '0x' + Array.from(new TextEncoder().encode(message))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      return p.request({ method: 'personal_sign', params: [hex, address] });
    },

    async sendTransfer({ from, chain, to, amountUnits }) {
      const p = provider();
      return p.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: chain.token, data: calldata(to, amountUnits), value: '0x0' }]
      });
    }
  };
})();
