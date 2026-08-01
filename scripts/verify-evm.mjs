import { rpc, verifyErc20Transfer } from './api/_evm.js';

const chain = {
  id: 'bsc', kind: 'evm',
  rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.bnbchain.org'],
  token: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, minConfirmations: 15
};

const head = BigInt(await rpc(chain.rpcs, 'eth_blockNumber', []));
let logs = [];
for (let back = 60n; back < 90n && !logs.length; back++) {
  const blk = '0x' + (head - back).toString(16);
  logs = await rpc(chain.rpcs, 'eth_getLogs', [{
    fromBlock: blk, toBlock: blk,
    address: chain.token,
    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
  }]);
}

const pick = logs.find(l => BigInt(l.data) > 10n ** 19n) || logs[0];
const recipient = '0x' + pick.topics[2].slice(-40);
console.log('test tx   :', pick.transactionHash);
console.log('recipient :', recipient);
console.log('amount    :', Number(BigInt(pick.data)) / 1e18, 'USDT');

const ok = await verifyErc20Transfer({ ...chain, address: recipient }, pick.transactionHash, 10n * 10n ** 18n);
console.log('VERIFY    :', JSON.stringify(ok));

const bad = await verifyErc20Transfer({ ...chain, address: '0x000000000000000000000000000000000000dEaD' }, pick.transactionHash, 10n * 10n ** 18n);
console.log('WRONG-ADDR:', bad.status);

const over = await verifyErc20Transfer({ ...chain, address: recipient }, pick.transactionHash, 10n ** 30n);
console.log('UNDERPAID :', over.status);
