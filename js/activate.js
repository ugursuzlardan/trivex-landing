/* ============ TRIVEX — activation flow (DEMO): wallet-connect payment ============ */

const TIERS = window.TRIVEX_TIERS;
const params = new URLSearchParams(location.search);
let tierKey = (params.get('tier') || 'platinum').toLowerCase();
if (!TIERS[tierKey]) tierKey = 'platinum';

const DEMO_ADDR = 'TQrY8Fk2mXvA5dNw3cJp7uHsE9gRkLzB4t'; // demo address, not a real wallet

/* Payment config from backend (network, receiving address, USDT contract).
   Null when the API is unreachable (e.g. local static preview) → demo mode. */
let PAYCFG = null;
fetch('/api/payment-config')
  .then(r => (r.ok ? r.json() : null))
  .then(cfg => {
    PAYCFG = cfg && cfg.ok ? cfg : null;
    if (PAYCFG && PAYCFG.mode === 'testnet') {
      const banner = document.querySelector('.demo-banner');
      if (banner) { banner.removeAttribute('data-i18n'); banner.textContent = t('act_testnet'); }
    }
    if (PAYCFG) {
      const hint = document.getElementById('netHint');
      hint.textContent = t('act_net_required') + ' ' + netLabel();
      hint.hidden = false;
    }
  })
  .catch(() => { PAYCFG = null; });

function netLabel() {
  return PAYCFG && PAYCFG.network === 'mainnet' ? 'TRON Mainnet' : 'Nile Testnet';
}

/* ---------- Stepper ---------- */
function goStep(n) {
  document.querySelectorAll('.flow-step').forEach(s => s.classList.remove('is-visible'));
  document.getElementById('step' + n).classList.add('is-visible');
  document.querySelectorAll('.stepper__item').forEach(item => {
    const i = +item.dataset.stepInd;
    item.classList.toggle('is-active', i === n);
    item.classList.toggle('is-done', i < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Step 1: plan picker ---------- */
function renderPlanPicker() {
  const picker = document.getElementById('planPicker');
  picker.innerHTML = '';
  Object.entries(TIERS).forEach(([key, tier]) => {
    const el = document.createElement('button');
    el.className = 'plan-opt' + (key === tierKey ? ' is-active' : '');
    el.innerHTML = `
      <span class="plan-opt__chip tier__card--${tier.cls}">${tier.label}</span>
      <b>$${tier.price}</b>
      <small>$${tier.limit.toLocaleString('en-US')}/${t('t_month')} · ${tier.topup}%</small>`;
    el.addEventListener('click', () => { tierKey = key; renderPlanPicker(); renderSummary(); });
    picker.appendChild(el);
  });
}

function payTotal() {
  const tier = TIERS[tierKey];
  return tier.price + tier.minTopup;
}

function renderSummary() {
  const tier = TIERS[tierKey];
  document.getElementById('flowSummary').innerHTML = `
    <div class="sumline"><span>Trivex ${tier.label} — ${t('tier_issue')}</span><b>$${tier.price}</b></div>
    <div class="sumline"><span>${t('act_first_topup')}</span><b>$${tier.minTopup}</b></div>
    <div class="sumline sumline--total"><span>${t('act_amount')}</span><b>${payTotal()} USDT</b></div>`;
}

/* ---------- Step 2: wallet-connect payment ---------- */
let timerId, qrDone = false, connectedWallet = null, realConnection = false;

function renderPayAmounts() {
  document.getElementById('payAmount').textContent = payTotal();
  document.getElementById('payBtn').textContent = `${t('act_pay')} ${payTotal()} USDT`;
  // the user sees exactly what they are paying for before signing
  const purpose = document.getElementById('payPurpose');
  if (purpose) {
    purpose.textContent =
      `${t('act_purpose')}: Trivex ${TIERS[tierKey].label} — ${t('tier_issue')} + ${t('act_first_topup')} · ${payTotal()} USDT (TRC-20)`;
  }
}

function startPayment() {
  renderPayAmounts();
  goStep(2);
}

document.getElementById('toPayment').addEventListener('click', () => {
  const email = document.getElementById('flowEmail');
  if (!email.value || !email.checkValidity()) { email.reportValidity(); return; }
  startPayment();
});

/* Connect a wallet — real injected TRON provider (TronLink / OKX / TokenPocket
   extensions and in-wallet dApp browsers). USDT TRC-20 (TRON) only for now.
   No provider → guide the user (install link / open in wallet app / manual
   transfer). The fake handshake survives only for the local preview (no API). */
const sleepC = ms => new Promise(r => setTimeout(r, ms));
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const SITE_URL = 'https://trivex-landing.vercel.app/activate.html';

const DEEP_LINKS = {
  'TronLink':    'tronlinkoutside://pull.activity?param=' + encodeURIComponent(JSON.stringify({ url: SITE_URL, action: 'open', protocol: 'tronlink', version: '1.0' })),
  'OKX Wallet':  'okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(SITE_URL),
  'TokenPocket': 'tpdapp://open?params=' + encodeURIComponent(JSON.stringify({ url: SITE_URL }))
};

let TWI = null;      // active tronWeb instance once connected (injected wallets)
let wcMode = false;  // connected via WalletConnect
let wcAddr = null;   // WalletConnect address

/* read-only TronWeb for building/broadcasting WC transactions and balance reads */
function roTronWeb() {
  const Ctor = window.TronWeb && (window.TronWeb.TronWeb || window.TronWeb);
  if (!Ctor) return null;
  const host = PAYCFG && PAYCFG.network === 'mainnet'
    ? 'https://api.trongrid.io' : 'https://nile.trongrid.io';
  return new Ctor({ fullHost: host });
}

function getTronProvider() {
  if (window.okxwallet && window.okxwallet.tronLink) return window.okxwallet.tronLink;
  return window.tronLink || null;
}
function getTronWeb() {
  if (window.okxwallet && window.okxwallet.tronWeb) return window.okxwallet.tronWeb;
  return window.tronWeb || null;
}
async function waitForProvider(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (getTronProvider() || getTronWeb()) return true;
    await sleepC(150);
  }
  return !!(getTronProvider() || getTronWeb());
}

function shortAddr(a) { return a.slice(0, 4) + '…' + a.slice(-4); }

/* which TRON network is the wallet's node on? */
function detectWalletNet(tw) {
  try {
    const host = ((tw.fullNode && tw.fullNode.host) || '').toLowerCase();
    if (host.includes('nile')) return 'nile';
    if (host.includes('shasta')) return 'shasta';
    return 'mainnet';
  } catch { return 'mainnet'; }
}

let netOk = false;

async function connectInjected() {
  const provider = getTronProvider();
  if (provider && provider.request) {
    await provider.request({ method: 'tron_requestAccounts' });
  }
  // address can appear a moment after approval
  let tw = null;
  for (let i = 0; i < 20; i++) {
    tw = getTronWeb();
    if (tw && tw.defaultAddress && tw.defaultAddress.base58) break;
    await sleepC(200);
  }
  if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
    throw new Error('no_provider');
  }
  TWI = tw;
  const addr = tw.defaultAddress.base58;
  const walletNet = detectWalletNet(tw);
  let balance = null, trx = null;
  if (!PAYCFG || walletNet === PAYCFG.network) {
    try {
      const usdt = PAYCFG ? PAYCFG.usdtContract : 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
      const contract = await tw.contract().at(usdt);
      const raw = await contract.balanceOf(addr).call();
      balance = (Number(raw.toString()) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch { /* balance read can fail on some nodes; address alone is enough */ }
    try { trx = (await tw.trx.getBalance(addr)) / 1e6; } catch { /* optional */ }
  }
  return { addr, balance, walletNet, trx };
}

function showConnected(name, addr, balance) {
  document.getElementById('connWalletName').textContent = name;
  document.getElementById('connAddr').textContent = shortAddr(addr);
  document.getElementById('connBalance').textContent = balance !== null ? balance : '—';
  document.getElementById('connectBox').hidden = true;
  document.getElementById('connectedBox').hidden = false;
}

function showNote(html) {
  const note = document.getElementById('connectNote');
  note.innerHTML = html;
  note.hidden = false;
}

function openManual() {
  const box = document.getElementById('manualBox');
  if (box.hidden) document.getElementById('manualToggle').click();
}

document.querySelectorAll('.connect-opt').forEach(btn => {
  btn.addEventListener('click', async () => {
    const name = btn.dataset.cwallet;
    const label = btn.childNodes[btn.childNodes.length - 1];
    const origLabel = label.textContent;
    btn.classList.add('is-connecting');
    label.textContent = ' ' + t('act_connecting');
    document.getElementById('connectNote').hidden = true;

    const reset = () => { btn.classList.remove('is-connecting'); label.textContent = origLabel; };

    // local preview without backend → keep the old simulated handshake
    if (!PAYCFG) {
      setTimeout(() => {
        connectedWallet = name; realConnection = false;
        showConnected(name, DEMO_ADDR, '2,431.80');
        btn.classList.remove('is-connecting');
      }, 1300);
      return;
    }

    // WalletConnect: QR / wallet-list modal — TRON support varies by wallet
    if (name === 'WalletConnect') {
      if (!window.TrivexWC) {
        reset(); showNote(t('act_note_wc_unavailable')); openManual();
        return;
      }
      showNote(t('act_note_wc_tron')); // which wallets actually sign TRON via WC
      try {
        const addr = await window.TrivexWC.connect(PAYCFG.network);
        netOk = true; // WC session is opened on the configured chain
        connectedWallet = 'WalletConnect';
        realConnection = true; wcMode = true; wcAddr = addr;
        let balance = null;
        try {
          const tw = roTronWeb();
          tw.setAddress(addr);
          const c = await tw.contract().at(PAYCFG.usdtContract);
          const raw = await c.balanceOf(addr).call();
          balance = (Number(raw.toString()) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } catch { /* balance is optional */ }
        showConnected('WalletConnect', addr, balance);
      } catch (e) {
        console.warn('walletconnect:', e && e.message);
        showNote(t('act_note_rejected'));
      } finally {
        reset();
      }
      return;
    }

    const hasProvider = await waitForProvider(1500);

    if (hasProvider) {
      try {
        const { addr, balance, walletNet, trx } = await connectInjected();
        connectedWallet = name;
        realConnection = true;
        showConnected(name, addr, balance);

        const connNote = document.getElementById('connNote');
        netOk = !PAYCFG || walletNet === PAYCFG.network;
        if (!netOk) {
          // wrong network: explain exactly what to switch to and block the pay button
          connNote.textContent = t('act_wrong_network').replace('{net}', netLabel());
          connNote.hidden = false;
          document.getElementById('payBtn').disabled = true;
        } else {
          document.getElementById('payBtn').disabled = false;
          if (trx !== null && trx < 25) {
            // enough TRX for the network fee is a common gotcha — warn early
            connNote.textContent = t('act_low_trx');
            connNote.hidden = false;
          } else {
            connNote.hidden = true;
          }
        }
      } catch {
        showNote(t('act_note_rejected'));
      } finally {
        btn.classList.remove('is-connecting');
        label.textContent = origLabel;
      }
      return;
    }

    // no injected provider
    reset();
    if (IS_MOBILE && DEEP_LINKS[name]) {
      showNote(t('act_note_open_wallet'));
      location.href = DEEP_LINKS[name];
      return;
    }
    if (name === 'TronLink') {
      showNote(t('act_note_install_tronlink') +
        ' <a href="https://www.tronlink.org/" target="_blank" rel="noopener">tronlink.org →</a>');
      return;
    }
    showNote(t('act_note_open_wallet'));
    openManual();
  });
});

/* Pay from connected wallet.
   Real path (TronLink + backend config): sign a genuine USDT TRC-20 transfer,
   then poll the backend, which verifies it on-chain via TronGrid.
   Demo path otherwise: simulated confirmation, no funds move. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function payReal(btn, status) {
  status.innerHTML = `<span class="pulse"></span><span>${t('act_confirm_wallet')}</span>`;
  let txid;
  try {
    if (wcMode) {
      // WalletConnect: build the unsigned transfer, wallet signs, we broadcast
      const tw = roTronWeb();
      tw.setAddress(wcAddr);
      const built = await tw.transactionBuilder.triggerSmartContract(
        tw.address.toHex(PAYCFG.usdtContract),
        'transfer(address,uint256)',
        { feeLimit: 100_000_000, callValue: 0 },
        [
          { type: 'address', value: PAYCFG.address },
          { type: 'uint256', value: Math.round(payTotal() * 1e6) }
        ],
        tw.address.toHex(wcAddr)
      );
      const signed = await window.TrivexWC.signTransaction(built.transaction);
      const receipt = await tw.trx.sendRawTransaction(signed);
      if (receipt && receipt.result === false) throw new Error('broadcast_failed');
      txid = built.transaction.txID;
    } else {
      // injected wallet: contract call signs and broadcasts in one step
      const tw = TWI || getTronWeb();
      const contract = await tw.contract().at(PAYCFG.usdtContract);
      txid = await contract
        .transfer(PAYCFG.address, Math.round(payTotal() * 1e6))
        .send({ feeLimit: 100_000_000 });
    }
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    console.warn('payment:', msg);
    let key = 'act_tx_fail';
    if (/balance|bandwit?dh|energy|resource|insufficient/i.test(msg)) key = 'act_err_funds';
    else if (/contract.*(not|does ?n)|not.*contract|REVERT/i.test(msg)) key = 'act_wrong_network_short';
    status.innerHTML = `<span>✕ ${t(key)}</span>`;
    btn.disabled = false;
    return;
  }

  status.innerHTML = `<span class="pulse"></span><span>${t('act_checking')}</span>`;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    try {
      const r = await fetch(`/api/verify-payment?txid=${txid}&tier=${tierKey}`);
      const data = await r.json();
      if (data.status === 'confirmed') {
        status.innerHTML = `<span class="status-ok">✓</span><span>${t('act_confirmed')}</span>`;
        await sleep(1200);
        return issueCard();
      }
      if (data.status === 'underpaid' || data.status === 'already_used') {
        status.innerHTML = `<span>✕ ${t('act_tx_fail')}</span>`;
        btn.disabled = false;
        return;
      }
      // 'pending' → keep polling
    } catch { /* transient network error → keep polling */ }
  }
  status.innerHTML = `<span>✕ ${t('act_tx_timeout')}</span>`;
  btn.disabled = false;
}

function payDemo(btn, status) {
  status.innerHTML = `<span class="pulse"></span><span>${t('act_confirm_wallet')}</span>`;
  setTimeout(() => {
    status.innerHTML = `<span class="pulse"></span><span>${t('act_checking')}</span>`;
    setTimeout(() => {
      status.innerHTML = `<span class="status-ok">✓</span><span>${t('act_confirmed')}</span>`;
      setTimeout(issueCard, 1400);
    }, 1800);
  }, 1800);
}

document.getElementById('payBtn').addEventListener('click', () => {
  const btn = document.getElementById('payBtn');
  const status = document.getElementById('payStatus2');
  if (realConnection && PAYCFG && !netOk) {
    const n = document.getElementById('connNote');
    n.textContent = t('act_wrong_network').replace('{net}', netLabel());
    n.hidden = false;
    return;
  }
  btn.disabled = true;
  status.hidden = false;
  if (realConnection && PAYCFG && (wcMode || TWI || getTronWeb())) {
    payReal(btn, status);
  } else {
    payDemo(btn, status);
  }
});

/* Manual fallback (QR + address + txid verification) */
function receivingAddr() { return PAYCFG ? PAYCFG.address : DEMO_ADDR; }

document.getElementById('manualToggle').addEventListener('click', () => {
  const box = document.getElementById('manualBox');
  const open = box.hidden;
  box.hidden = !open;
  document.getElementById('manualToggle').textContent = open ? t('act_manual_hide') : t('act_manual_toggle');
  if (open && !qrDone) {
    document.getElementById('payAddr').textContent = receivingAddr();
    new QRCode(document.getElementById('qrBox'), {
      text: receivingAddr(), width: 170, height: 170,
      colorDark: '#07090f', colorLight: '#ffffff'
    });
    qrDone = true;
    let left = 15 * 60;
    clearInterval(timerId);
    timerId = setInterval(() => {
      left--;
      if (left < 0) { clearInterval(timerId); return; }
      const m = String(Math.floor(left / 60)).padStart(2, '0');
      const s = String(left % 60).padStart(2, '0');
      document.getElementById('payTimer').textContent = `${m}:${s}`;
    }, 1000);
  }
});

document.getElementById('copyAddr').addEventListener('click', async e => {
  await navigator.clipboard.writeText(receivingAddr()).catch(() => {});
  e.target.textContent = t('act_copied');
  setTimeout(() => { e.target.textContent = t('act_copy'); }, 1800);
});

document.getElementById('checkTx').addEventListener('click', async () => {
  const status = document.getElementById('payStatus');
  const btn = document.getElementById('checkTx');
  btn.disabled = true;

  // real mode: verify the pasted txid on-chain
  if (PAYCFG) {
    const txid = (document.getElementById('manualTxid').value || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      status.innerHTML = `<span>✕ ${t('act_txid_invalid')}</span>`;
      btn.disabled = false;
      return;
    }
    status.innerHTML = `<span class="pulse"></span><span>${t('act_checking')}</span>`;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(`/api/verify-payment?txid=${txid}&tier=${tierKey}`);
        const data = await r.json();
        if (data.status === 'confirmed') {
          status.innerHTML = `<span class="status-ok">✓</span><span>${t('act_confirmed')}</span>`;
          await sleep(1200);
          return issueCard();
        }
        if (data.status === 'underpaid' || data.status === 'already_used') {
          status.innerHTML = `<span>✕ ${t('act_tx_fail')}</span>`;
          btn.disabled = false;
          return;
        }
      } catch { /* transient error → keep polling */ }
      await sleep(3000);
    }
    status.innerHTML = `<span>✕ ${t('act_tx_timeout')}</span>`;
    btn.disabled = false;
    return;
  }

  // local preview: simulated confirmation
  status.innerHTML = `<span class="pulse"></span><span>${t('act_checking')}</span>`;
  setTimeout(() => {
    status.innerHTML = `<span class="status-ok">✓</span><span>${t('act_confirmed')}</span>`;
    setTimeout(issueCard, 1600);
  }, 2200);
});

/* ---------- Step 3: card issue (mock data) ---------- */
let cardData = null;

function issueCard() {
  const rnd = n => Math.floor(Math.random() * n);
  const groups = ['5375', String(4100 + rnd(899)),
                  String(1000 + rnd(8999)), String(1000 + rnd(8999))];
  cardData = {
    number: groups.join(' '),
    exp: `${String(1 + rnd(12)).padStart(2, '0')}/29`,
    cvv: String(100 + rnd(899))
  };
  document.getElementById('doneTier').textContent = TIERS[tierKey].label;
  hideDetails();
  goStep(3);
}

function maskNumber(num) {
  return '•••• •••• •••• ' + num.slice(-4);
}
function hideDetails() {
  document.getElementById('doneNumber').textContent = maskNumber(cardData.number);
  document.getElementById('doneExp').textContent = '••/••';
  document.getElementById('doneCvv').textContent = '•••';
}
let revealed = false;
document.getElementById('revealBtn').addEventListener('click', e => {
  revealed = !revealed;
  if (revealed) {
    document.getElementById('doneNumber').textContent = cardData.number;
    document.getElementById('doneExp').textContent = cardData.exp;
    document.getElementById('doneCvv').textContent = cardData.cvv;
    e.target.textContent = t('act_hide');
  } else {
    hideDetails();
    e.target.textContent = t('act_reveal');
  }
});

/* ---------- init + re-render on language change ---------- */
function renderAll() {
  renderPlanPicker();
  renderSummary();
  renderPayAmounts();
  const w = localStorage.getItem('trivex_wallet');
  document.getElementById('flowWallet').textContent =
    w && w !== 'other' ? w : t('act_wallet_none');
}
document.addEventListener('langchange', renderAll);
renderAll();
