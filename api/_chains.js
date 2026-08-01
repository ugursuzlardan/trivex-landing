/* Trivex — supported payment chains.

   A chain is only offered to customers once its receiving address is set in
   the environment, so adding a chain is a config change, not a code change.
   Token contracts and decimals were verified on-chain: BSC's USDT uses 18
   decimals while the others use 6. */

export const CHAINS = {
  tron: {
    id: 'tron',
    kind: 'tron',
    label: 'TRON · TRC-20',
    short: 'TRON',
    decimals: 6,
    addressEnv: 'TRON_RECEIVING_ADDRESS',
    tokenEnv: 'TRON_USDT_CONTRACT',
    minConfirmations: 19
  },
  bsc: {
    id: 'bsc',
    kind: 'evm',
    label: 'BNB Chain · BEP-20',
    short: 'BNB',
    chainId: 56,
    chainIdHex: '0x38',
    rpcs: [
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed1.bnbchain.org',
      'https://bsc-dataseed2.bnbchain.org'
    ],
    token: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    addressEnv: 'EVM_RECEIVING_ADDRESS',
    minConfirmations: 15,
    explorer: 'https://bscscan.com'
  },
  ethereum: {
    id: 'ethereum',
    kind: 'evm',
    label: 'Ethereum · ERC-20',
    short: 'ETH',
    chainId: 1,
    chainIdHex: '0x1',
    rpcs: [
      'https://ethereum-rpc.publicnode.com',
      'https://cloudflare-eth.com',
      'https://rpc.ankr.com/eth'
    ],
    token: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    addressEnv: 'EVM_RECEIVING_ADDRESS',
    minConfirmations: 12,
    explorer: 'https://etherscan.io'
  },
  polygon: {
    id: 'polygon',
    kind: 'evm',
    label: 'Polygon · USDT',
    short: 'POL',
    chainId: 137,
    chainIdHex: '0x89',
    rpcs: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon-rpc.com'
    ],
    token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    decimals: 6,
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    addressEnv: 'EVM_RECEIVING_ADDRESS',
    minConfirmations: 30,
    explorer: 'https://polygonscan.com'
  },
  arbitrum: {
    id: 'arbitrum',
    kind: 'evm',
    label: 'Arbitrum · USDT',
    short: 'ARB',
    chainId: 42161,
    chainIdHex: '0xa4b1',
    rpcs: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arb1.arbitrum.io/rpc'
    ],
    token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    addressEnv: 'EVM_RECEIVING_ADDRESS',
    minConfirmations: 20,
    explorer: 'https://arbiscan.io'
  }
};

/* which chains are actually usable right now */
export function enabledChains() {
  const wanted = (process.env.ENABLED_CHAINS || 'tron')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  return wanted
    .map(id => CHAINS[id])
    .filter(Boolean)
    .map(c => {
      const address = process.env[c.addressEnv];
      const token = c.kind === 'tron' ? process.env[c.tokenEnv] : c.token;
      if (!address || !token) return null;
      return { ...c, address, token };
    })
    .filter(Boolean);
}

export function getChain(id) {
  return enabledChains().find(c => c.id === id) || null;
}
