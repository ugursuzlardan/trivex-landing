# Trivex — Landing Page

Web3 cüzdanından USDT (TRON/TRC-20) ile ödeme yapıp sanal kart aktifleştirme servisi — landing page + aktivasyon akışı + dashboard prototipi.

**Durum: DEMO** — gerçek ödeme kabul edilmiyor; tüm ödeme/kart akışları arayüz prototipidir.

## Sayfalar

- `index.html` — landing (UA/EN, cüzdan seçimi, 4 tarife, banka entegrasyonu "yakında", FAQ, waitlist)
- `activate.html` — 3 adımlı aktivasyon: tarife → cüzdan bağla & öde (TRC-20; manuel QR yedeği) → kart
- `dashboard.html` — kullanıcı paneli mockup (bakiye, dondur/çöz, işlemler, limitler)

## Yapı

- Saf HTML/CSS/JS — build gerektirmez, her statik hosta deploy edilebilir
- `js/i18n.js` — UA/EN çevirileri + `TRIVEX_TIERS` tarife verisi (tek kaynak)
- `js/main.js`, `js/activate.js`, `js/dashboard.js` — sayfa davranışları

## Lokal çalıştırma

```bash
python -m http.server 8899
```

→ http://localhost:8899
