# Tariflar: taklif (2026-10-23)

Egasi tasdiqlashi uchun bir sahifa. Narxlar — gipoteza: pilotlardan keyin oʻzgartirish uchun hammasi
bitta joyda (`packages/domain/src/billing/plans.ts`) turadi, landing esa test orqali shu raqamlarga
bogʻlangan. Bu branch (`claude/charming-benz-5187ec`) tavsiya etilgan variantni toʻliq amalga oshiradi;
merge qilinmaguncha hech narsa oʻzgarmaydi.

## 1. Tavsiya: toʻrt pogʻona, rollar boʻyicha nomlar

| | **Koʻrik** | **Korxona** | **Buxgalter** | **Byuro** |
|---|---|---|---|---|
| Kimlar uchun | Katalogidagi xatolarni birinchi marta koʻrmoqchi boʻlgan har kim | Bitta kompaniya: doʻkon, qurilish mollari sotuvchisi, distribyutor | 10 tagacha mijozga xizmat qiladigan buxgalter yoki kichik firma | Koʻp mijozli buxgalteriya autsorsing firmasi |
| Oylik narx | Bepul, 14 kun | 390 000 soʻm | 900 000 soʻm | 1 800 000 soʻm |
| Yillik narx (10 oy hisobida) | — | 3 900 000 soʻm (oyiga 325 000) | 9 000 000 soʻm (oyiga 750 000) | 18 000 000 soʻm (oyiga 1 500 000) |
| Riskli pozitsiyalar va sabablari | ✓ | ✓ | ✓ | ✓ |
| Kod takliflari va tasdiqlash | ✓ | ✓ | ✓ | ✓ |
| Jamoa: admin, buxgalter, kuzatuvchi | ✓ | ✓ | ✓ | ✓ |
| Harakatlar jurnali | ✓ | ✓ | ✓ | ✓ |
| Firma lugʻati: kodlar eslab qolinadi | ✓ | ✓ | ✓ | ✓ |
| Toʻgʻrilangan fayl: Excel, 1C, PDF | — | ✓ | ✓ | ✓ |
| Oylik eslatmalar | — | ✓ | ✓ | ✓ |
| API: 1C, Google Sheets | ✓ | ✓ | ✓ | ✓ |
| Oʻz logotipingiz bilan PDF | — | — | ✓ | ✓ |
| Mijozga havola orqali hisobot | — | — | ✓ | ✓ |
| Mijozlar | 3 | 1 (oʻz kompaniyasi) | 10 | cheklanmagan |
| Oyiga tekshiriladigan pozitsiyalar (SKU) | 5 000 | 20 000 | 50 000 | 200 000 |
| Foydalanuvchilar | 2 | 3 | 5 | 10 |
| Oyiga API tekshiruvlari | 500 | 1 000 | 10 000 | 50 000 |

**Imkoniyatlar jadvali** har bir kartada oʻz roʻyxati sifatida turadi (qisqa qatorlar, ✓/—);
izohlar yordam maqolasida, kartalar ostida bitta «Imkoniyatlar haqida batafsil» havolasi.
Jadval bitta joyda: `PLAN_FEATURES` (`packages/domain/src/billing/plans.ts`); landing, yordam maqolasi va ilova
shuni oʻqiydi, test landing nusxasini tekshiradi. Ilova «—» ni haqiqatan yopadi:
- **Oylik eslatmalar** — Koʻrikda eslatmani yoqib boʻlmaydi, kunlik ish eslatma yubormaydi;
- **Oʻz logotipingiz bilan PDF** — Koʻrik va Korxonada nom/logotip saqlanmaydi, PDF firma nomisiz chiqadi
  (avval saqlangani tarif pasaysa chiqmaydi);
- **Mijozga havola** — Koʻrik va Korxonada yangi havola yaratilmaydi (403 `plan_feature`, sababi aytiladi);
  mavjud havolalar muddatigacha ishlaydi;
- **Toʻgʻrilangan fayl** — `BILLING_REQUIRED_FOR_EXPORT=true` bilan (6-boʻlim, 1-savol).

Qarorlar: Korxona — bitta kompaniya, shuning uchun mijozga havola va brendli PDF (mijozlarga beriladigan
narsalar) yoʻq, eslatma va API bor. Koʻrikda API ✓ qoldi: sinovda 500 ta tekshiruv bor va firmalar 1C
ulanishini aynan sinov paytida tekshiradi; uni yopish kerak boʻlsa, `PLANS.trial.apiChecks` ni 0 qilish kifoya.
Jamoa, jurnal va lugʻat hamma tarifda: ularsiz tekshiruvning oʻzi ishlamaydi (kim tasdiqladi, nima eslab qolindi).

**Bitta katalogdagi SKU va oyiga kataloglar soni** alohida cheklanmaydi: ikkalasini ham «oyiga
tekshiriladigan pozitsiyalar» qamrab oladi. Sabab: xarajat qatorlar soniga bogʻliq, kataloglar soniga
emas; 50 qatorli va 10 000 qatorli katalogni bir xil «1 katalog» deb sanash adolatsiz. Har pogʻonada
oylik chegara eng katta odatiy katalogni ikki marta tekshirishga yetadi (tuzatishdan keyin qayta yuklash
uchun). Bitta katalog oylik chegaradan katta boʻlsa — yuqori pogʻona yoki individual narx.

**Bepul pogʻona (Koʻrik) aniq doirasi:** roʻyxatdan oʻtgandan keyin 14 kun; 3 mijoz, oyiga 5 000
pozitsiya, 2 foydalanuvchi, 500 API tekshiruvi; riskli pozitsiyalar roʻyxati, sabablari, kod takliflari
va ularni tasdiqlash. Toʻgʻrilangan fayl (Excel, 1C, PDF) kirmaydi — bu `BILLING_REQUIRED_FOR_EXPORT=true`
bilan ishlaydi (6-boʻlim, 1-savol). 14 kundan keyin maʼlumotlar saqlanadi, yangi yuklash yopiladi.
Landing orqali faylni roʻyxatdan oʻtmasdan yuborish (bir ish kunida bepul risk hisobot) oʻzgarmaydi.

**Bir martalik «Toʻgʻrilangan katalog» saqlanadi**, lekin kartochka emas, kartalar ostidagi bitta
qator: 500 SKU — 700 000, 2 000 SKU — 1 500 000, 10 000 SKU — 4 000 000 soʻm. Sabablari:
1) obuna xohlamaydigan doʻkon katalogini bir marta tozalaydi va ketadi — uni yoʻqotmaymiz;
2) pilotlar shu formatda (ish bajarilgandan keyin bank oʻtkazmasi) kelishilgan;
3) yozilgan buyurtmalar `catalog_500/2000/10000` id larida — ular oʻzgarmaydi.
Kamchiligi: kichik doʻkon bir oylik «Korxona» (390 000) ni bir martalik 700 000 dan arzon topadi.
Buni qabul qilamiz: oylik obuna ham daromad, 1 iyul 2026 dan EHF cheklovlari va tasniflagich
yangilanishlari katalogni qayta eskirtiradi, shuning uchun qaytib kelish ehtimoli bor.

**Toʻlov:** hozir bank oʻtkazmasi orqali, ish bajarilgandan keyin (landing shuni aytadi). Click/Payme
kalitlari sozlangach ilovada onlayn toʻlov ochiladi va landing izohi `NEXT_PUBLIC_ONLINE_PAYMENT=true`
bilan buni ham aytadi. Bank oʻtkazmasi kelganda tarif `npm run billing:activate` bilan yoqiladi
(toʻlangan buyurtma yoziladi, muddat 1 yoki 12 oyga uzayadi).

## 2. Ruscha nomlar

| Oʻzbekcha | Ruscha | Kimlar uchun (ru) |
|---|---|---|
| Koʻrik | Проверка | Все, кто хочет впервые увидеть ошибки в каталоге |
| Korxona | Предприятие | Одна компания: магазин, продавец стройматериалов, дистрибьютор |
| Buxgalter | Бухгалтер | Бухгалтер или небольшая фирма, до 10 клиентов |
| Byuro | Бюро | Аутсорсинговая бухгалтерская фирма с большим числом клиентов |
| Toʻgʻrilangan katalog | Исправленный каталог | Разовое исправление одного каталога |

## 3. Uchta muqobil nomlar toʻplami

| Pogʻona | **A. Rollar (tavsiya)** | B. Buxgalteriya hujjatlari | C. Savdo hajmi |
|---|---|---|---|
| Bepul | Koʻrik | Chek | Namuna |
| Bitta kompaniya | Korxona | Faktura | Javon |
| 10 tagacha mijoz | Buxgalter | Jurnal | Ombor |
| Koʻp mijoz | Byuro | Balans | Ulgurji |

- **A. Rollar** — nom oʻzi «kim uchun» degan savolga javob beradi; buxgalter oʻzini darhol topadi.
  Xavf: korxonaning shtatdagi buxgalteri «Buxgalter» ni tanlashi mumkin — kartadagi «Kimlar uchun»
  qatori buni hal qiladi. **Tavsiya etiladi.**
- **B. Hujjatlar** — buxgalterga yaqin va esda qoladi (chek → faktura → jurnal → balans), lekin
  pogʻonalar tartibi va kim uchunligi noaniq: «Jurnal» «Faktura» dan kattami?
- **C. Savdo hajmi** — doʻkon va distribyutorga tushunarli, lekin asosiy mijoz — autsorsing
  firmasi — oʻzini bu nomlarda koʻrmaydi.

Rad etilgan yoʻnalish: MXIK kodi tuzilishi (Guruh, Sinf, Pozitsiya) — chiroyli, lekin
«Pozitsiya» katalog pozitsiyasi bilan chalkashadi.

Kodda id lar rolga bogʻlanmagan (`company_*`, `accountant_*`, `firm_*`): boshqa toʻplam tanlansa,
faqat `packages/i18n/src/i18n-parts/pricing.ts` dagi nomlar oʻzgaradi.

## 4. Hozirgi boʻlim va taklif

| | Hozir | Taklif |
|---|---|---|
| Nomlar | «Risk auditi», uch marta «Toʻgʻrilangan katalog» | Koʻrik, Korxona, Buxgalter, Byuro + bir martalik «Toʻgʻrilangan katalog» |
| Kim uchun | Yozilmagan | Har kartada «Kimlar uchun» qatori |
| Nima kiradi | 3 ta umumiy qator, chegaralar yoʻq | 3 ta belgili qator (✓/—) + 4 ta chegara (mijoz, SKU, foydalanuvchi, API) |
| Firmalar uchun obuna | Landingda yoʻq; narx `PLAN_FIRM_PRICE` da, oʻrnatilmagan | Ikki pogʻona (Buxgalter, Byuro), narxlar koʻrinadi |
| Oylik / yillik | Yoʻq | Almashtirgich; yillik = 10 oy narxi («2 oy bepul») |
| Bepul doira | «Riskli pozitsiyalar roʻyxati» (ilovadagi sinov bilan bogʻlanmagan) | 14 kunlik sinov bilan bir xil, chegaralari koʻrsatilgan |
| Narx manbai | Landing matni va `plans.ts` alohida, qoʻlda | `plans.ts` yagona manba; landing test bilan tekshiriladi |
| Ilova chegaralari | Sinov va «firma» (env bilan, landingda yoʻq) | Har pogʻona chegarasi `plans.ts` da; ilova aynan shuni qoʻllaydi |
| Toʻlov izohi | Bank oʻtkazmasi, ishdan keyin | Oʻsha + onlayn toʻlov (bayroq yoqilganda) |

## 5. Orqaga moslik

- `catalog_500`, `catalog_2000`, `catalog_10000` — narx va maʼno oʻzgarmagan.
- `firm_monthly` — endi «Byuro, oylik» (eng yuqori pogʻona, ilgari cheklanmagan edi); yozilgan
  toʻlovlar va eski checkout soʻrovlari ishlayveradi.
- Toʻlov buyurtmasi yoʻq, lekin `subscriptionUntil` qoʻlda qoʻyilgan tashkilot «Byuro» chegaralarini oladi.
- API javoblariga faqat yangi maydonlar qoʻshildi (`tiers`, `status.tier`, `plan.tier`, `plan.months`).
- `PLAN_FIRM_PRICE`, `PLAN_TRIAL_*`, `PLAN_FIRM_*`, `API_CHECKS_PER_MONTH_*` env oʻzgaruvchilari endi
  oʻqilmaydi: raqamlar bitta joyda boʻlishi kerak, aks holda landing va ilova ajralib ketadi.

## 6. Egasi uchun ochiq savollar

1. `BILLING_REQUIRED_FOR_EXPORT=true` productionda yoqilsinmi? Usiz bepul pogʻona ham
   toʻgʻrilangan faylni yuklab oladi va landingdagi «—» belgisi notoʻgʻri boʻladi.
2. Narxlar: 390 000 / 900 000 / 1 800 000 soʻm oyiga — taxmin. Pilotdagi firmalar mijoz boshiga
   qancha toʻlashga tayyor?
3. Byuro chegaralari (200 000 SKU, 10 foydalanuvchi, 50 000 API) ilgari «cheklanmagan» edi.
   Cheklanmagan qoldirilsinmi?
4. Pogʻonani oy oʻrtasida oshirish: hozir yangi toʻlov muddatni uzaytiradi va soʻnggi toʻlangan pogʻona
   amal qiladi (qayta hisoblash yoʻq). Qisman qaytarish/qayta hisoblash kerakmi?
5. Imkoniyatlar jadvali (yuqorida) toʻgʻrimi? Ayniqsa: Koʻrikda API qolsinmi, Korxonaga brendli PDF
   kerakmi (masalan, distribyutor oʻz dilerlariga hisobot bersa)?
6. Bitta katalog 200 000 SKU dan katta yoki 10 000 SKU dan katta bir martalik — «individual narx»; buni
   landingda yozish kerakmi?
