/* Checks the TRON recipient decoding against both ABI encodings wallets use.
   Run: node scripts/verify-tron.mjs */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ToHex(addr) {
  let num = 0n;
  for (const ch of addr) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    num = num * 58n + BigInt(i);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hex.slice(0, -8).toLowerCase();
}

/* mirrors api/verify-payment.js */
function decode(data, receiver) {
  const d = data.toLowerCase();
  if (!d.startsWith('a9059cbb') || d.length < 8 + 128) return { ok: false, why: 'not_transfer' };
  const toHex = d.slice(8 + 64 - 40, 8 + 64);
  const amount = BigInt('0x' + d.slice(8 + 64, 8 + 128));
  const want = base58ToHex(receiver).slice(2);
  return { ok: toHex === want, amount, toHex, want };
}

const RECEIVER = 'TUZpJ3VEKErnUDP1iULwigUNFAApnyb78Z';

const cases = [
  {
    name: 'TronLink encoding (bare 20-byte address)',
    txid: 'f570fa8f16c9562d7402a3e2b5014eeda18e7f833fabb8d8c27a84569e0ab654',
    expectUsdt: 10
  },
  {
    name: 'prefixed encoding (0x41 + 20 bytes)',
    txid: '2ecfd3435e4bffcfe724181413b014fef323e9315694fdf8336f881d1ad996d3',
    expectUsdt: 9350
  }
];

let failed = 0;
for (const c of cases) {
  const r = await fetch('https://api.trongrid.io/wallet/gettransactionbyid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: c.txid, visible: true })
  }).then(r => r.json());

  const data = r.raw_data.contract[0].parameter.value.data;
  const out = decode(data, RECEIVER);
  const usdt = Number(out.amount) / 1e6;
  const pass = out.ok && usdt === c.expectUsdt;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(`      arg=${data.slice(8, 72)}`);
  console.log(`      decoded=${out.toHex} expected=${out.want} amount=${usdt}`);
}

console.log(failed ? `\n${failed} case(s) failed` : '\nall recipient encodings verify');
process.exit(failed ? 1 : 0);
