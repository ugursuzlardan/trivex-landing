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
      window.PAYCFG_CHAINS = PAYCFG.chains || [];
      CHAIN = chains()[0] || null;
      renderChainTabs();
      renderWalletList();
      renderPayAmounts();
      const hint = document.getElementById('netHint');
      hint.textContent = t('act_net_required') + ' ' + netLabel();
      hint.hidden = false;
      if (PAYCFG.mode === 'live') {
        const banner = document.querySelector('.demo-banner');
        if (banner) {
          banner.removeAttribute('data-i18n');
          banner.textContent = t('act_private_live');
          banner.classList.add('demo-banner--live');
        }
      }
    }
  })
  .catch(() => { PAYCFG = null; });

/* is this wallet allowed to pay during private testing? */
async function checkCanPay(address) {
  try {
    const r = await fetch('/api/can-pay?address=' + encodeURIComponent(address));
    const d = await r.json();
    return !!d.allowed;
  } catch { return false; }
}

function netLabel() {
  return PAYCFG && PAYCFG.network === 'mainnet' ? 'TRON Mainnet' : 'Nile Testnet';
}

/* ---------- chains ---------- */
let CHAIN = null;   // the chain the customer is paying from

function chains() { return (PAYCFG && PAYCFG.chains) || []; }
function isEvm() { return CHAIN && CHAIN.kind === 'evm'; }
/* chains we can drive from the page vs. ones paid by plain transfer */
function hasWalletFlow() { return CHAIN && (CHAIN.kind === 'tron' || CHAIN.kind === 'evm'); }

/* smallest unit of the chain's USDT (TRON/ETH: 6 decimals, BSC: 18) */
function amountUnits() {
  return BigInt(payTotal()) * 10n ** BigInt(CHAIN ? CHAIN.decimals : 6);
}

function renderChainTabs() {
  const box = document.getElementById('netTabs');
  if (!box) return;
  const list = chains();
  box.innerHTML = '';
  if (!CHAIN && list.length) CHAIN = list[0];
  list.forEach(c => {
    const b = document.createElement('button');
    b.className = 'net-tab' + (CHAIN && c.id === CHAIN.id ? ' is-active' : '');
    b.textContent = c.label;
    b.addEventListener('click', () => {
      if (CHAIN && c.id === CHAIN.id) return;
      CHAIN = c;
      resetConnection();
      renderChainTabs();
      renderWalletList();
      renderPayAmounts();
    });
    box.appendChild(b);
  });
}

/* drop any wallet session when the customer switches chain */
function resetConnection() {
  SIGNER = null; TWI = null; wcMode = false; wcAddr = null;
  realConnection = false; connectedWallet = null; walletUsdt = null; netOk = false;
  document.getElementById('connectBox').hidden = false;
  document.getElementById('connectedBox').hidden = true;
  document.getElementById('connectNote').hidden = true;
  const cn = document.getElementById('connNote');
  if (cn) cn.hidden = true;
  qrDone = false;
  const qr = document.getElementById('qrBox');
  if (qr) qr.innerHTML = '';
  const mb = document.getElementById('manualBox');
  if (mb && !mb.hidden) document.getElementById('manualToggle').click();
}

const WALLETS_TRON = [
  { id: 'TronLink',       icon: 'TL',  color: '#C23631' },
  { id: 'OKX Wallet',     icon: 'OKX', color: '#0f0f0f' },
  { id: 'TokenPocket',    icon: 'TP',  color: '#2761E7' },
  { id: 'Trust Wallet',   icon: 'TW',  color: '#3375BB', sub: 'WalletConnect' },
  { id: 'Binance Wallet', icon: 'B',   color: '#F0B90B', dark: true, sub: 'Web3' },
  { id: 'WalletConnect',  icon: 'WC',  color: '#3B99FC', sub: 'Bitget · imToken…' }
];

const WALLETS_EVM = [
  { id: 'MetaMask',        icon: 'MM',  color: '#E2761B' },
  { id: 'Trust Wallet',    icon: 'TW',  color: '#3375BB' },
  { id: 'Binance Wallet',  icon: 'B',   color: '#F0B90B', dark: true },
  { id: 'Coinbase Wallet', icon: 'CB',  color: '#0052FF' },
  { id: 'OKX Wallet',      icon: 'OKX', color: '#0f0f0f' }
];

function renderWalletList() {
  const box = document.getElementById('connectList');
  if (!box) return;
  box.innerHTML = '';

  // no in-page signing for this chain → the customer just sends and we detect
  // the payment automatically
  if (!hasWalletFlow()) {
    document.getElementById('connectBox').hidden = true;
    showNote(t('act_note_transfer_only').replace('{chain}', CHAIN ? CHAIN.short : ''));
    openManual();
    return;
  }
  document.getElementById('connectBox').hidden = false;

  // one button: AppKit's modal lists every wallet and deep-links on mobile
  if (window.TrivexKit) {
    const b = document.createElement('button');
    b.className = 'connect-opt connect-opt--primary';
    b.dataset.cwallet = 'AppKit';
    b.innerHTML = `<span class="wallet__icon" style="--wc:#3B99FC">◈</span>${t('act_connect_wallet')}`;
    b.addEventListener('click', () => connectViaKit(b));
    box.appendChild(b);

    const alt = document.createElement('button');
    alt.className = 'connect-opt connect-opt--alt';
    alt.textContent = t('act_other_ways');
    alt.addEventListener('click', () => { box.dataset.expanded = '1'; renderLegacyWallets(box); });
    box.appendChild(alt);
    if (box.dataset.expanded) renderLegacyWallets(box);
    return;
  }

  renderLegacyWallets(box);
}

/* direct per-wallet buttons, kept as a fallback if the SDK fails to load */
function renderLegacyWallets(box) {
  box.querySelectorAll('.connect-opt--legacy').forEach(el => el.remove());
  (isEvm() ? WALLETS_EVM : WALLETS_TRON).forEach(w => {
    const b = document.createElement('button');
    b.className = 'connect-opt connect-opt--legacy';
    b.dataset.cwallet = w.id;
    b.innerHTML =
      `<span class="wallet__icon" style="--wc:${w.color}${w.dark ? ';color:#000' : ''}${w.color === '#0f0f0f' ? ';border:1px solid #333' : ''}">${w.icon}</span>` +
      w.id + (w.sub ? ` <small class="connect-opt__sub">${w.sub}</small>` : '');
    b.addEventListener('click', () => handleConnect(w.id, b));
    box.appendChild(b);
  });
}

/* connect through AppKit and wire it up as the active signer */
async function connectViaKit(btn) {
  const label = btn.childNodes[btn.childNodes.length - 1];
  const orig = label.textContent;
  btn.classList.add('is-connecting');
  label.textContent = ' ' + t('act_connecting');
  document.getElementById('connectNote').hidden = true;
  try {
    const addr = await window.TrivexKit.connect(CHAIN.id);
    await afterRemoteConnect(t('act_wallet_connected_label'), addr, {
      signMessage: msg => window.TrivexKit.signMessage(CHAIN.id, msg, addr),
      sendTransfer: () => window.TrivexKit.pay(CHAIN.id, {
        from: addr, to: CHAIN.address, amountUnits: amountUnits(), tier: tierKey
      }),
      walletLink: () => null   // AppKit handles the app switch itself
    });
  } catch (e) {
    console.warn('appkit connect:', e && e.message);
    showNote(t('act_note_rejected'));
  } finally {
    btn.classList.remove('is-connecting');
    label.textContent = orig;
  }
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
let IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const SITE_URL = 'https://trivex-landing.vercel.app/activate.html';

/* Fallbacks for reopening a wallet app when the session carries no redirect */
const WALLET_APP_LINKS = {
  'Trust Wallet': 'trust://',
  'Binance Wallet': 'bnc://',
  'OKX Wallet': 'okx://',
  'TokenPocket': 'tpoutside://',
  'Bitget Wallet': 'bitkeep://'
};

/* Bring the connected wallet to the foreground so the customer actually sees
   the pending approval. Only meaningful for remote signers on mobile. */
function openWalletApp() {
  if (!IS_MOBILE || !wcMode) return;
  let link = null;
  try { link = SIGNER && SIGNER.walletLink ? SIGNER.walletLink() : null; } catch { /* optional */ }
  link = link || WALLET_APP_LINKS[connectedWallet] || null;
  if (!link) return;
  try { window.location.href = link; } catch { /* browser may block it */ }
}

/* Status line plus a manual "open wallet" button, because iOS often blocks a
   programmatic app switch that is not tied to a tap. */
function pendingStatus(status, key) {
  status.innerHTML = `<span class="pulse"></span><span>${t(key)}</span>`;
  if (IS_MOBILE && wcMode) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost btn--sm openwallet';
    b.textContent = t('act_open_wallet_btn');
    b.addEventListener('click', openWalletApp);
    status.appendChild(b);
  }
}

const DEEP_LINKS = {
  'TronLink':    'tronlinkoutside://pull.activity?param=' + encodeURIComponent(JSON.stringify({ url: SITE_URL, action: 'open', protocol: 'tronlink', version: '1.0' })),
  'OKX Wallet':  'okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(SITE_URL),
  'TokenPocket': 'tpdapp://open?params=' + encodeURIComponent(JSON.stringify({ url: SITE_URL }))
};

let TWI = null;         // active tronWeb instance once connected (injected wallets)
let wcMode = false;     // connected through a remote signer (WalletConnect / Binance)
let wcAddr = null;      // that wallet's address
let SIGNER = null;      // object exposing signMessage / signTransaction
let walletUsdt = null;  // connected wallet's USDT balance

/* Chain work for WalletConnect wallets runs on the backend: TronWeb's browser
   dist needs Node's Buffer, so building/broadcasting here would fail. */
async function apiTron(action, opts = {}) {
  const url = '/api/tron-tx?action=' + action + (opts.query || '');
  const init = opts.body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) }
    : {};
  const r = await fetch(url, init);
  return r.json();
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
  let balance = null, balanceNum = null, trx = null;
  if (!PAYCFG || walletNet === PAYCFG.network) {
    try {
      const usdt = PAYCFG ? PAYCFG.usdtContract : 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
      const contract = await tw.contract().at(usdt);
      const raw = await contract.balanceOf(addr).call();
      balanceNum = Number(raw.toString()) / 1e6;
      balance = balanceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch { /* balance read can fail on some nodes; address alone is enough */ }
    try { trx = (await tw.trx.getBalance(addr)) / 1e6; } catch { /* optional */ }
  }
  return { addr, balance, balanceNum, walletNet, trx };
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

/* Shared tail for wallets that sign remotely (WalletConnect, Binance, EVM):
   read balances from the backend and run the same pre-flight checks the
   injected TRON wallets get. */
async function afterRemoteConnect(label, addr, signer) {
  SIGNER = signer;
  connectedWallet = label;
  realConnection = true; wcMode = true; wcAddr = addr; netOk = true;

  let balance = null;
  const bal = isEvm()
    ? await fetch(`/api/evm-balance?chain=${CHAIN.id}&address=${encodeURIComponent(addr)}`)
        .then(r => r.json()).catch(() => null)
    : await apiTron('balance', { query: '&address=' + encodeURIComponent(addr) })
        .catch(() => null);
  if (bal && bal.ok) {
    walletUsdt = bal.usdt;
    balance = bal.usdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  showConnected(label, addr, balance);

  const note = document.getElementById('connNote');
  note.hidden = true;
  document.getElementById('payBtn').disabled = false;
  if (bal && bal.ok && bal.usdt < payTotal()) {
    note.textContent = t('act_low_usdt')
      .replace('{have}', bal.usdt.toFixed(2))
      .replace('{need}', payTotal());
    note.hidden = false;
    document.getElementById('payBtn').disabled = true;
    netOk = false;
  } else if (bal && bal.ok && !isEvm() && bal.trx < 25) {
    note.textContent = t('act_low_trx');
    note.hidden = false;
  } else if (bal && bal.ok && isEvm() && bal.native <= 0) {
    // no native coin → the wallet cannot pay gas on this chain
    note.textContent = t('act_low_gas').replace('{sym}', bal.symbol || '');
    note.hidden = false;
  }
}

function openManual() {
  const box = document.getElementById('manualBox');
  if (box.hidden) document.getElementById('manualToggle').click();
}

async function handleConnect(name, btn) {
  {
    const label = btn.childNodes[btn.childNodes.length - 1];
    const origLabel = label.textContent;
    btn.classList.add('is-connecting');
    label.textContent = ' ' + t('act_connecting');
    document.getElementById('connectNote').hidden = true;

    const reset = () => { btn.classList.remove('is-connecting'); label.textContent = origLabel; };

    /* ---------- EVM chains: one EIP-1193 provider covers every wallet ---------- */
    if (isEvm()) {
      if (!window.TrivexEVM || !window.TrivexEVM.isAvailable()) {
        reset();
        showNote(IS_MOBILE ? t('act_note_evm_mobile') : t('act_note_evm_install'));
        openManual();
        return;
      }
      try {
        const addr = await window.TrivexEVM.connect(CHAIN);
        await afterRemoteConnect(window.TrivexEVM.name() || name, addr, {
          signMessage: msg => window.TrivexEVM.signMessage(msg, addr),
          sendTransfer: () => window.TrivexEVM.sendTransfer({
            from: addr, chain: CHAIN, to: CHAIN.address, amountUnits: amountUnits()
          })
        });
      } catch (e) {
        console.warn('evm connect:', e && e.message);
        showNote(t('act_note_rejected'));
      } finally {
        reset();
      }
      return;
    }

    // local preview without backend → keep the old simulated handshake
    if (!PAYCFG) {
      setTimeout(() => {
        connectedWallet = name; realConnection = false;
        showConnected(name, DEMO_ADDR, '2,431.80');
        btn.classList.remove('is-connecting');
      }, 1300);
      return;
    }

    // Binance Web3 Wallet: its own TRON adapter when injected, else WalletConnect
    if (name === 'Binance Wallet') {
      try {
        if (window.TrivexBinance && await window.TrivexBinance.isSupported()) {
          const addr = await window.TrivexBinance.connect();
          await afterRemoteConnect(name, addr, window.TrivexBinance);
          return;
        }
        if (IS_MOBILE && window.TrivexBinance) {
          // open the page inside the Binance app, where the wallet is injected
          showNote(t('act_note_binance_app'));
          window.TrivexBinance.openApp();
          return;
        }
        // desktop without the extension → Binance is also listed in WalletConnect
        showNote(t('act_note_binance_wc'));
        const addr = await window.TrivexWC.connect(PAYCFG.network);
        await afterRemoteConnect(name, addr, window.TrivexWC);
      } catch (e) {
        console.warn('binance:', e && e.message);
        showNote(t('act_note_rejected'));
      } finally {
        reset();
      }
      return;
    }

    // WalletConnect: QR / wallet-list modal (Trust, Bitget, TokenPocket, imToken…)
    if (name === 'WalletConnect' || name === 'Trust Wallet') {
      if (!window.TrivexWC) {
        reset(); showNote(t('act_note_wc_unavailable')); openManual();
        return;
      }
      showNote(name === 'Trust Wallet' ? t('act_note_trust') : t('act_note_wc_tron'));
      try {
        const addr = await window.TrivexWC.connect(PAYCFG.network);
        await afterRemoteConnect(name, addr, window.TrivexWC);
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
        const { addr, balance, balanceNum, walletNet, trx } = await connectInjected();
        connectedWallet = name;
        realConnection = true;
        walletUsdt = balanceNum;
        showConnected(name, addr, balance);

        const connNote = document.getElementById('connNote');
        netOk = !PAYCFG || walletNet === PAYCFG.network;
        if (!netOk) {
          // wrong network: explain exactly what to switch to and block the pay button
          connNote.textContent = t('act_wrong_network').replace('{net}', netLabel());
          connNote.hidden = false;
          document.getElementById('payBtn').disabled = true;
        } else if (!(await checkCanPay(addr))) {
          // private testing: real funds, so only allowlisted wallets may pay
          netOk = false;
          connNote.textContent = t('act_not_allowed');
          connNote.hidden = false;
          document.getElementById('payBtn').disabled = true;
        } else {
          document.getElementById('payBtn').disabled = false;
          connNote.hidden = true;
          // catch the two things that silently revert the transfer on-chain
          if (walletUsdt !== null && walletUsdt < payTotal()) {
            connNote.textContent = t('act_low_usdt')
              .replace('{have}', walletUsdt.toFixed(2))
              .replace('{need}', payTotal());
            connNote.hidden = false;
            document.getElementById('payBtn').disabled = true;
            netOk = false;
          } else if (trx !== null && trx < 25) {
            connNote.textContent = t('act_low_trx');
            connNote.hidden = false;
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
  }
}

/* Pay from connected wallet.
   Real path (TronLink + backend config): sign a genuine USDT TRC-20 transfer,
   then poll the backend, which verifies it on-chain via TronGrid.
   Demo path otherwise: simulated confirmation, no funds move. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The wallet shows the text of a signed message to the user, so the order
   details and terms are put in front of them before any funds move. */
function buildTermsMessage(orderRef) {
  const tier = TIERS[tierKey];
  const L = window.trivexLang === 'en' ? {
    head: 'TRIVEX — Card activation',
    plan: 'Plan', amount: 'Amount', to: 'Recipient', order: 'Order',
    intro: 'By signing you confirm the terms below:',
    terms: [
      '1. This is a one-time activation fee for a Trivex virtual card, plus your first top-up.',
      '2. Crypto payments are final: once confirmed on the TRON network they cannot be reversed.',
      '3. Trivex is not a bank. Cards are issued through licensed payment partners.',
      '4. You must be 18+ and comply with the laws of your country. Higher limits require verification (KYC).',
      '5. TEST MODE: the service is under development and cards are NOT being issued yet.'
    ],
    note: 'Signing this message costs nothing and moves no funds.'
  } : {
    head: 'TRIVEX — Активація картки',
    plan: 'Тариф', amount: 'Сума', to: 'Отримувач', order: 'Замовлення',
    intro: 'Підписуючи, ти підтверджуєш умови:',
    terms: [
      '1. Це разова комісія за випуск віртуальної картки Trivex та перше поповнення.',
      '2. Криптоплатежі незворотні: після підтвердження в мережі TRON скасувати неможливо.',
      '3. Trivex не є банком. Картки випускаються через ліцензованих платіжних партнерів.',
      '4. Тобі має бути 18+, і ти дотримуєшся законів своєї країни. Вищі ліміти потребують верифікації (KYC).',
      '5. ТЕСТОВИЙ РЕЖИМ: сервіс у розробці, картки поки НЕ випускаються.'
    ],
    note: 'Підпис цього повідомлення безкоштовний і не переказує кошти.'
  };
  return [
    L.head + ' #' + orderRef,
    '',
    `${L.plan}: Trivex ${tier.label}`,
    `${L.amount}: ${payTotal()} USDT (${CHAIN ? CHAIN.label : 'TRON · TRC-20'})`,
    `${L.to}: ${CHAIN ? CHAIN.address : PAYCFG.address}`,
    '',
    L.intro,
    ...L.terms,
    '',
    L.note
  ].join('\n');
}

async function signTerms(status) {
  const orderRef = String(Math.floor(100000 + Math.random() * 899999));
  const message = buildTermsMessage(orderRef);
  pendingStatus(status, 'act_sign_terms');

  let signature;
  if (wcMode) {
    // fire the request first, then jump to the wallet so the prompt is visible
    const pending = SIGNER.signMessage(message);
    openWalletApp();
    signature = await pending;
  } else {
    const tw = TWI || getTronWeb();
    signature = await tw.trx.signMessageV2(message);
  }
  if (!signature) throw new Error('terms_not_signed');

  const address = wcMode ? wcAddr : (TWI || getTronWeb()).defaultAddress.base58;
  // best-effort: a stored consent record should never block a paying customer
  fetch('/api/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, tier: tierKey, orderRef, message, signature })
  }).catch(() => {});

  return orderRef;
}

async function payReal(btn, status) {
  let txid;

  // terms first — the wallet renders this text on its approval screen
  try {
    await signTerms(status);
  } catch (e) {
    console.warn('terms:', String((e && e.message) || e || ''));
    status.innerHTML = `<span>✕ ${t('act_err_terms')}</span>`;
    btn.disabled = false;
    return;
  }

  pendingStatus(status, 'act_confirm_wallet');
  try {
    if (isEvm()) {
      // EVM: the wallet builds, signs and broadcasts; we only supply calldata
      const pending = SIGNER.sendTransfer();
      openWalletApp();
      txid = await pending;
      if (!txid) throw new Error('not_signed');
    } else if (wcMode) {
      // WalletConnect: backend builds it, the wallet signs, backend broadcasts
      const built = await apiTron('build', { body: { from: wcAddr, tier: tierKey } });
      if (!built || !built.ok) throw new Error(built && built.error || 'build_failed');

      const pending = SIGNER.signTransaction(built.transaction);
      openWalletApp();
      const signed = await pending;
      if (!signed || !signed.signature) throw new Error('not_signed');

      const sent = await apiTron('broadcast', { body: { transaction: signed } });
      if (!sent || !sent.ok) throw new Error(sent && sent.error || 'broadcast_failed');
      txid = sent.txid;
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
    if (/not_signed/i.test(msg)) key = 'act_err_not_signed';
    else if (/build_failed|broadcast_failed|chain_unavailable/i.test(msg)) key = 'act_err_chain';
    else if (/balance|bandwit?dh|energy|resource|insufficient/i.test(msg)) key = 'act_err_funds';
    else if (/contract.*(not|does ?n)|not.*contract|REVERT/i.test(msg)) key = 'act_wrong_network_short';
    status.innerHTML = `<span>✕ ${t(key)}</span>`;
    btn.disabled = false;
    return;
  }

  status.innerHTML = `<span class="pulse"></span><span>${t('act_checking')}</span>`;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    try {
      const r = await fetch(`/api/verify-payment?txid=${txid}&tier=${tierKey}&chain=${CHAIN ? CHAIN.id : 'tron'}`);
      const data = await r.json();
      if (data.status === 'confirmed') {
        status.innerHTML = `<span class="status-ok">✓</span><span>${t('act_confirmed')}</span>`;
        await sleep(1200);
        return issueCard();
      }
      if (data.status === 'failed') {
        const why = /ENERGY|BANDWIDTH/i.test(data.reason || '') ? 'act_err_energy' : 'act_err_reverted';
        status.innerHTML = `<span>✕ ${t(why)}</span>`;
        btn.disabled = false;
        return;
      }
      if (data.status === 'not_allowed') {
        status.innerHTML = `<span>✕ ${t('act_not_allowed')}</span>`;
        btn.disabled = false;
        return;
      }
      if (data.status === 'wrong_tx' || data.status === 'wrong_token' || data.status === 'wrong_recipient') {
        status.innerHTML = `<span>✕ ${t('act_err_wrong_tx')}</span>`;
        btn.disabled = false;
        return;
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

/* ---------- automatic payment detection ----------
   An order reserves a unique amount, so a transfer from any wallet or
   exchange identifies itself. Nothing has to be pasted. */
let ORDER = null, watchTimer = null;

async function createOrder() {
  const r = await fetch('/api/order?action=create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: tierKey, chain: CHAIN ? CHAIN.id : 'tron' })
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'order_failed');
  ORDER = d;
  return d;
}

function stopWatching() {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
}

/* poll until the payment lands, then issue the card */
function startWatching(statusEl) {
  stopWatching();
  let ticks = 0;
  watchTimer = setInterval(async () => {
    ticks++;
    if (!ORDER || ticks > 220) return stopWatching();     // ~18 minutes
    try {
      const r = await fetch(`/api/order?action=status&ref=${ORDER.ref}`);
      const d = await r.json();
      if (d.status === 'paid') {
        stopWatching();
        statusEl.innerHTML = `<span class="status-ok">✓</span><span>${t('act_confirmed')}</span>`;
        setTimeout(issueCard, 1200);
      } else if (d.status === 'confirming') {
        statusEl.innerHTML = `<span class="pulse"></span><span>${t('act_confirming')
          .replace('{n}', d.confirmations || 0)}</span>`;
      } else if (d.status === 'expired') {
        stopWatching();
        statusEl.innerHTML = `<span>✕ ${t('act_order_expired')}</span>`;
      }
    } catch { /* keep polling through transient errors */ }
  }, 5000);
}

/* Manual fallback (QR + address + txid verification) */
function receivingAddr() {
  if (CHAIN) return CHAIN.address;
  return PAYCFG ? PAYCFG.address : DEMO_ADDR;
}

document.getElementById('manualToggle').addEventListener('click', async () => {
  const box = document.getElementById('manualBox');
  const open = box.hidden;
  box.hidden = !open;
  document.getElementById('manualToggle').textContent = open ? t('act_manual_hide') : t('act_manual_toggle');
  if (!open) { stopWatching(); return; }

  if (open && PAYCFG) {
    // reserve a unique amount and start watching the chain for it
    const status = document.getElementById('payStatus');
    try {
      const o = await createOrder();
      document.getElementById('payAddr').textContent = o.address;
      const amtEl = document.getElementById('manualAmount');
      if (amtEl) amtEl.textContent = o.amount + ' USDT';
      const qr = document.getElementById('qrBox');
      qr.innerHTML = '';
      new QRCode(qr, { text: o.address, width: 170, height: 170, colorDark: '#07090f', colorLight: '#ffffff' });
      qrDone = true;
      status.innerHTML = `<span class="pulse"></span><span>${t('act_watching')}</span>`;
      startWatching(status);
    } catch (e) {
      console.warn('order:', e && e.message);
      status.innerHTML = `<span>✕ ${t('act_err_chain')}</span>`;
    }
    return;
  }

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
    const raw = (document.getElementById('manualTxid').value || '').trim();
    // hash format differs per chain: TRON hex, EVM 0x-prefixed, Solana base58
    const kind = CHAIN ? CHAIN.kind : 'tron';
    const txid = kind === 'solana' ? raw : raw.toLowerCase();
    const valid =
      kind === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(txid) :
      kind === 'evm'    ? /^0x[0-9a-f]{64}$/.test(txid) :
                          /^[0-9a-f]{64}$/.test(txid);
    if (!valid) {
      status.innerHTML = `<span>✕ ${t('act_txid_invalid')}</span>`;
      btn.disabled = false;
      return;
    }
    status.innerHTML = `<span class="pulse"></span><span>${t('act_checking')}</span>`;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(`/api/verify-payment?txid=${txid}&tier=${tierKey}&chain=${CHAIN ? CHAIN.id : 'tron'}`);
        const data = await r.json();
        if (data.status === 'confirmed') {
          status.innerHTML = `<span class="status-ok">✓</span><span>${t('act_confirmed')}</span>`;
          await sleep(1200);
          return issueCard();
        }
        if (data.status === 'failed') {
        const why = /ENERGY|BANDWIDTH/i.test(data.reason || '') ? 'act_err_energy' : 'act_err_reverted';
        status.innerHTML = `<span>✕ ${t(why)}</span>`;
        btn.disabled = false;
        return;
      }
      if (data.status === 'not_allowed') {
        status.innerHTML = `<span>✕ ${t('act_not_allowed')}</span>`;
        btn.disabled = false;
        return;
      }
      if (data.status === 'wrong_tx' || data.status === 'wrong_token' || data.status === 'wrong_recipient') {
        status.innerHTML = `<span>✕ ${t('act_err_wrong_tx')}</span>`;
        btn.disabled = false;
        return;
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
  renderChainTabs();
  renderWalletList();
  const w = localStorage.getItem('trivex_wallet');
  document.getElementById('flowWallet').textContent =
    w && w !== 'other' ? w : t('act_wallet_none');
}
document.addEventListener('langchange', renderAll);
renderAll();
