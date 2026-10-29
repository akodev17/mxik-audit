# Deploy checklist (2026-10-28)

`DEPLOY.md` asosida, `tasnivo.uz` ga birinchi deploy uchun. Kod tomoni tayyor, quyidagilar egadan kerak.

## Tekshirilgan (main `d76af84`)

| Nima | Natija |
|---|---|
| `docker compose --profile app build` | web, api, worker uchta image xatosiz qurildi (1.7 GB har biri) |
| `prisma migrate deploy` bo'sh bazada | 55/55 migratsiya qo'llandi |
| typecheck, lint, `npm test` | toza; 2133/2136, bitta `demo.test.ts` faqat umumiy bazada yiqiladi, alohida o'tadi |
| `.env.example` | deploy uchun kerakli har bir o'zgaruvchi bor |
| `tmp/found-catalogs/perechen.xlsx` (64 KB) | EHF cheklangan kodlar ro'yxati, serverga qo'lda ko'chiriladi (gitda yo'q) |

## Egadan kerak (deploy kuni oldin)

1. **VPS**: Ubuntu 22.04/24.04, 4 vCPU, 8 GB RAM, 30 GB disk. SSH kalit bilan kirish, `sudo`.
   Claude Desktop → SSH connections ga qo'shilsa, deploy sessiyasi serverda ishlaydi.
2. **DNS**: `tasnivo.uz` va `www.tasnivo.uz` uchun `A` yozuvlar server IP ga. `dig +short tasnivo.uz` IP ni ko'rsatishi kerak.
3. **SMTP** (majburiy, usiz ro'yxatdan o'tish ishlamaydi): Gmail app-parol (DEPLOY.md 7c) yoki boshqa provayder → `SMTP_URL`, `MAIL_FROM`.
4. **Pullik Gemini kalit** (`GEMINI_API_KEY`): bepul tarif kuniga 20 so'rov, pilot uchun yetmaydi. Chatda ko'rsatilgan eski kalitni o'chiring.
5. **Google sign-in**: Google Console da clientga `https://tasnivo.uz/api/auth/google/callback` qo'shish, consent screen ni publish qilish, chatda ko'rsatilgan client secret ni yangilash. Serverda `GOOGLE_REDIRECT_URI` qo'yilmaydi.
6. **Telegram**: BotFather da `/revoke` bilan yangi token (eskisi chatda ko'ringan), domen `tasnivo.uz` (allaqachon shunday).
7. **`ADMIN_EMAILS`**: `/admin` ochadigan pochtalar.
8. **Yuridik matnlar**: `/maxfiylik` va `/oferta` uchun matn (hozir placeholder).
9. **Click/Payme** (ixtiyoriy): kalitlar bo'lmasa to'lov tugmasi chiqmaydi, bank o'tkazmasi `npm run billing:activate` bilan qo'lda yoziladi. Pilot uchun shu yetarli.
10. **`BILLING_REQUIRED_FOR_EXPORT=true`** productionda yoqilsinmi, qaror (landing bepul tarifda tuzatilgan fayl yo'q deydi, demak `true`).

## Serverda ketma-ketlik (DEPLOY.md 1–6, qisqa)

```bash
# 1. server: docker, ufw 22/80/443
# 2. DNS tekshirish
# 3. kod va .env
sudo mkdir -p /opt/mxik-audit && sudo chown "$USER" /opt/mxik-audit
git clone https://github.com/akodev17/mxik-audit.git /opt/mxik-audit && cd /opt/mxik-audit
cp .env.example .env && chmod 600 .env    # SITE_DOMAIN, POSTGRES_PASSWORD, SESSION_SECRET, CRON_SECRET, SMTP_*, APP_URL, NEXT_PUBLIC_SITE_URL, GEMINI_API_KEY, ADMIN_EMAILS
mkdir -p backups data && sudo chown -R 1000:1000 data
# 4–5. baza va klassifikator (~3–4 soat, embed:catalog tmux ichida)
docker compose --profile app build && docker compose up -d db redis
alias mx='docker compose --profile app run --rm --no-deps worker'
mx npx prisma migrate deploy && mx npm run fetch:catalog && mx npm run ingest -- --enrich && mx npm run load:db
mx npm run embed:catalog && mx npm run seed:demo
# perechen.xlsx ni ./data ga ko'chirgandan keyin:
mx npm run load:restricted -- data/perechen.xlsx
# 6. stack
docker compose --profile app up -d && curl -s https://tasnivo.uz/api/health
```

## Deploy kuni tekshiruvlar

- `docker compose logs caddy | grep -i certificate` ikkala nom uchun sertifikat.
- `/api/health` → `classifier.loaded: true`, `codeCount ≈ 442 964`.
- Real pochtaga sign-up kodi keladi (`mx npm run mail:test -- siz@pochta`).
- Google orqali kirish, Telegram orqali kirish (faqat shu domenda tekshiriladi).
- Bitta real katalog yuklab audit: reranker `gemini:gemini-3.1-flash-lite`, `degradedReasons` bo'sh.
- Platform admin flagini qo'yish (DEPLOY.md 7g), `/admin` ochiladi.
- Zaxira: `./backups` da birinchi dump, restore drill (DEPLOY.md 9), tashqi nusxa (`rclone`/`rsync`).
- `perf:nav` serverda o'lchash.

## Keyinroq (pilotni to'xtatmaydi)

Phase C S3 (1C transfer tekshirilmagan ulanish bilan, balans farqi faqat ogohlantirish, yorliqlar, 1C host uchun DNS rebinding), Didox/1C real tizimda sinov, `Finding.reason` faqat o'zbekcha, reranker to'xtasa UI da xabar, e2e to'liq yurgizish.
