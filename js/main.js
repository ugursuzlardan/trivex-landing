/* ============ TRIVEX LANDING — main.js (behavior only; i18n in i18n.js) ============ */

/* ---------- Mobile menu ---------- */
const burger = document.getElementById('burger');
const navLinks = document.getElementById('navLinks');
burger.addEventListener('click', () => navLinks.classList.toggle('is-open'));
navLinks.addEventListener('click', () => navLinks.classList.remove('is-open'));

/* ---------- Wallet selection ---------- */
document.querySelectorAll('.wallet').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('wallet--soon')) return; // ERC-20 wallets: not yet
    document.querySelectorAll('.wallet').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    localStorage.setItem('trivex_wallet', btn.dataset.wallet);
    document.getElementById('cards').scrollIntoView({ behavior: 'smooth' });
  });
});

/* Restore previously selected wallet */
const savedWallet = localStorage.getItem('trivex_wallet');
if (savedWallet) {
  const btn = document.querySelector(`.wallet[data-wallet="${savedWallet}"]`);
  if (btn) btn.classList.add('is-selected');
}

/* ---------- Tier selection → activation flow ---------- */
document.querySelectorAll('[data-tier]').forEach(btn => {
  btn.addEventListener('click', () => {
    location.href = `activate.html?tier=${btn.dataset.tier.toLowerCase()}`;
  });
});

/* ---------- Waitlist form (placeholder until backend) ---------- */
document.getElementById('waitlistForm').addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('waitlistOk').hidden = false;
  e.target.querySelector('input').value = '';
});

/* ---------- 3D card tilt ---------- */
const card = document.getElementById('card3d');
if (card && matchMedia('(pointer: fine)').matches) {
  const wrap = card.parentElement;
  wrap.addEventListener('mousemove', e => {
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `rotateY(${x * 22}deg) rotateX(${-y * 16}deg)`;
  });
  wrap.addEventListener('mouseleave', () => {
    card.style.transform = 'rotateY(-12deg) rotateX(8deg)';
  });
}
