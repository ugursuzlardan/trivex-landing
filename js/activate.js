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
  })
  .catch(() => { PAYCFG = null; });

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

/* Connect a wallet — real TronLink when the extension is present, demo otherwise.
   USDT TRC-20 (TRON) only for now. */
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // official USDT contract on TRON

function shortAddr(a) { return a.slice(0, 4) + '…' + a.slice(-4); }

async function connectTronLink() {
  // TronLink injects window.tronLink / window.tronWeb
  const provider = window.tronLink || null;
  if (provider) {
    await provider.request({ method: 'tron_requestAccounts' });
  }
  const tw = window.tronWeb;
  if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
    throw new Error('tronlink_unavailable');
  }
  const addr = tw.defaultAddress.base58;
  let balance = null;
  try {
    const contract = await tw.contract().at(USDT_TRC20);
    const raw = await contract.balanceOf(addr).call();
    balance = (Number(raw.toString()) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch { /* balance read can fail on some nodes; address alone is enough */ }
  return { addr, balance };
}

function showConnected(name, addr, balance) {
  document.getElementById('connWalletName').textContent = name;
  document.getElementById('connAddr').textContent = shortAddr(addr);
  document.getElementById('connBalance').textContent = balance !== null ? balance : '—';
  document.getElementById('connectBox').hidden = true;
  document.getElementById('connectedBox').hidden = false;
}

document.querySelectorAll('.connect-opt').forEach(btn => {
  btn.addEventListener('click', async () => {
    const name = btn.dataset.cwallet;
    btn.classList.add('is-connecting');
    const label = btn.childNodes[btn.childNodes.length - 1];
    const origLabel = label.textContent;
    label.textContent = ' ' + t('act_connecting');

    if (name === 'TronLink' && (window.tronLink || window.tronWeb)) {
      // real connection: real address + real USDT balance
      try {
        const { addr, balance } = await connectTronLink();
        connectedWallet = name;
        realConnection = true;
        showConnected(name, addr, balance);
      } catch {
        label.textContent = origLabel;
      } finally {
        btn.classList.remove('is-connecting');
      }
      return;
    }

    // demo handshake for wallets without an injected TRON provider
    setTimeout(() => {
      connectedWallet = name;
      realConnection = false;
      showConnected(name, 'TQrY8Fk2mXvA5dNw3cJp7uHsE9gRkLzB4t', '2,431.80');
      btn.classList.remove('is-connecting');
    }, 1300);
  });
});

/* Pay from connected wallet.
   Real path (TronLink + backend config): sign a genuine USDT TRC-20 transfer,
   then poll the backend, which verifies it on-chain via TronGrid.
   Demo path otherwise: simulated confirmation, no funds move. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function payReal(btn, status) {
  const tw = window.tronWeb;
  status.innerHTML = `<span class="pulse"></span><span>${t('act_confirm_wallet')}</span>`;
  let txid;
  try {
    const contract = await tw.contract().at(PAYCFG.usdtContract);
    txid = await contract
      .transfer(PAYCFG.address, Math.round(payTotal() * 1e6))
      .send({ feeLimit: 100_000_000 });
  } catch {
    status.innerHTML = `<span>✕ ${t('act_tx_fail')}</span>`;
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
  btn.disabled = true;
  status.hidden = false;
  if (realConnection && PAYCFG && window.tronWeb) {
    payReal(btn, status);
  } else {
    payDemo(btn, status);
  }
});

/* Manual fallback (QR + address) */
document.getElementById('manualToggle').addEventListener('click', () => {
  const box = document.getElementById('manualBox');
  const open = box.hidden;
  box.hidden = !open;
  document.getElementById('manualToggle').textContent = open ? t('act_manual_hide') : t('act_manual_toggle');
  if (open && !qrDone) {
    new QRCode(document.getElementById('qrBox'), {
      text: DEMO_ADDR, width: 170, height: 170,
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
  await navigator.clipboard.writeText(DEMO_ADDR).catch(() => {});
  e.target.textContent = t('act_copied');
  setTimeout(() => { e.target.textContent = t('act_copy'); }, 1800);
});

document.getElementById('checkTx').addEventListener('click', () => {
  const status = document.getElementById('payStatus');
  const btn = document.getElementById('checkTx');
  btn.disabled = true;
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
