/* Trivex — payment deep links.

   A WalletConnect session has to be negotiated, and wallets reject the whole
   proposal when one requested chain is missing ("some of the required chains
   are not supported yet"). A payment URI skips all of that: the link carries
   the recipient, token and amount, the wallet opens with the transfer already
   filled in, and the customer only approves. Combined with amount-based
   detection this needs no connection and no copy-paste.

   Formats used:
     EVM     ERC-681  ethereum:<token>@<chainId>/transfer?address=..&uint256=..
     TRON    Trust Wallet deep link (asset id 195 = TRON)
     Solana  Solana Pay  solana:<to>?amount=..&spl-token=<mint> */

(function () {
  const TRUST = 'https://link.trustwallet.com';

  function units(amount, decimals) {
    // amount may carry cents; keep it exact in the token's smallest unit
    const [i, f = ''] = String(amount).split('.');
    const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(i + frac).toString();
  }

  window.TrivexPayLink = {
    /* generic URI understood by wallets and QR scanners */
    uri(chain, to, amount) {
      if (chain.kind === 'evm') {
        return `ethereum:${chain.token}@${chain.chainId}/transfer` +
               `?address=${to}&uint256=${units(amount, chain.decimals)}`;
      }
      if (chain.kind === 'solana') {
        return `solana:${to}?amount=${amount}&spl-token=${chain.token}`;
      }
      // TRON has no widely honoured URI scheme; Trust's link works broadly
      return `${TRUST}/send?asset=c195_t${chain.token}&address=${to}&amount=${amount}`;
    },

    /* link that opens a specific wallet app with the transfer prepared */
    walletUri(walletId, chain, to, amount) {
      const generic = this.uri(chain, to, amount);
      if (walletId === 'trust') {
        if (chain.kind === 'tron') return generic;                 // already a Trust link
        const coin = chain.kind === 'solana' ? 501 : 60;            // SLIP-44 ids
        return `${TRUST}/send?asset=c${coin}_t${chain.token}&address=${to}&amount=${amount}`;
      }
      if (walletId === 'metamask') {
        return 'https://metamask.app.link/send/' +
               `${chain.token}@${chain.chainId}/transfer?address=${to}&uint256=${units(amount, chain.decimals)}`;
      }
      if (walletId === 'phantom' && chain.kind === 'solana') {
        return `https://phantom.app/ul/browse/${encodeURIComponent(generic)}`;
      }
      return generic;
    },

    /* which wallet buttons make sense for this chain */
    walletsFor(chain) {
      if (chain.kind === 'tron') return [{ id: 'trust', label: 'Trust Wallet' }];
      if (chain.kind === 'solana') return [{ id: 'phantom', label: 'Phantom' }, { id: 'trust', label: 'Trust Wallet' }];
      return [{ id: 'metamask', label: 'MetaMask' }, { id: 'trust', label: 'Trust Wallet' }];
    }
  };
})();
