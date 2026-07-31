/* ============ TRIVEX — dashboard (DEMO, mock data) ============ */

const MOCK_TX = [
  { icon: '🎬', name: 'Netflix',            when: 'today',     amount: -12.99 },
  { icon: '🤖', name: 'OpenAI · ChatGPT',   when: 'today',     amount: -20.00 },
  { icon: '➕', name: 'topup',              when: 'yesterday', amount: +250.00 },
  { icon: '🎵', name: 'Spotify',            when: 'yesterday', amount: -4.99 },
  { icon: '📣', name: 'Google Ads',         when: '28.07',     amount: -145.50 },
  { icon: '🛒', name: 'AliExpress',         when: '27.07',     amount: -63.12 },
  { icon: '➕', name: 'topup',              when: '25.07',     amount: +1000.00 },
  { icon: '✈️', name: 'Ryanair',            when: '24.07',     amount: -89.00 }
];

function whenLabel(w) {
  if (w === 'today') return t('dash_today');
  if (w === 'yesterday') return t('dash_yesterday');
  return w;
}

function renderTx() {
  const ul = document.getElementById('txList');
  ul.innerHTML = '';
  MOCK_TX.forEach(tx => {
    const li = document.createElement('li');
    li.className = 'txitem';
    const name = tx.name === 'topup' ? t('dash_tx_topup') : tx.name;
    const cls = tx.amount > 0 ? 'txitem__amt--in' : '';
    const sign = tx.amount > 0 ? '+' : '−';
    li.innerHTML = `
      <span class="txitem__icon">${tx.icon}</span>
      <span class="txitem__name">${name}<small>${whenLabel(tx.when)}</small></span>
      <span class="txitem__amt ${cls}">${sign}$${Math.abs(tx.amount).toFixed(2)}</span>`;
    ul.appendChild(li);
  });
}
document.addEventListener('langchange', renderTx);
renderTx();

/* Freeze toggle */
let frozen = false;
const freezeBtn = document.getElementById('freezeBtn');
freezeBtn.addEventListener('click', () => {
  frozen = !frozen;
  document.getElementById('frozenOverlay').hidden = !frozen;
  document.getElementById('dashCard').classList.toggle('is-frozen', frozen);
  freezeBtn.textContent = frozen ? t('dash_unfreeze') : t('dash_freeze');
});

/* Top-up → reuse activation payment screen */
document.getElementById('topupBtn').addEventListener('click', () => {
  location.href = 'activate.html?tier=platinum';
});

/* Details: mock reveal */
document.getElementById('detailsBtn').addEventListener('click', () => {
  const num = document.querySelector('#dashCard .card3d__number');
  num.textContent = num.textContent.includes('••')
    ? '5375 4128 9034 7204'
    : '5375 41•• •••• 7204';
});
