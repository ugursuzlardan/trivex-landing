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

/* ---------- Waitlist form → /api/waitlist ---------- */
document.getElementById('waitlistForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const emailInput = form.querySelector('input[type=email]');
  const btn = form.querySelector('button');
  const ok = document.getElementById('waitlistOk');
  const err = document.getElementById('waitlistErr');
  ok.hidden = true; err.hidden = true;
  btn.disabled = true;
  try {
    const r = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailInput.value,
        lang: window.trivexLang,
        tier: localStorage.getItem('trivex_wallet') || null,
        website: form.querySelector('[name=website]').value
      })
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      ok.hidden = false;
      emailInput.value = '';
    } else {
      err.hidden = false;
    }
  } catch {
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
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
