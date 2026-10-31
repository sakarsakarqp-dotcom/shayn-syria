# باكند شَيْن

Node.js + Express + PostgreSQL. الحسابات (JWT)، الردود المجانية (3) وباقة 5$، الضمان، النزاعات، التقييم، لوحة الإدارة، وربط شام كاش.

## التشغيل المحلي
1. `npm install`
2. أنشئ قاعدة PostgreSQL ثم نفّذ `schema.sql` عليها.
3. انسخ `.env.example` إلى `.env` وعبّئه (JWT_SECRET عشوائي طويل).
4. `npm run seed-admin` لإنشاء حساب الإدارة من قيم `.env` (الإيميل سري هنا فقط)، ثم احذف ADMIN_PASSWORD من الملف.
5. `npm start`

## النشر
استضافة الخادم: Render أو Railway أو Fly.io. قاعدة البيانات: Neon أو Supabase أو Railway Postgres. ضع قيم `.env` كمتغيرات بيئة في لوحة الاستضافة، لا في المستودع.

## ربط شام كاش
- عدّل `shamcash.js` ليطابق واجهة باكند شام كاش لديك. بلا `SHAM_API_URL` يعمل بوضع تجريبي.
- اجعل شام كاش يستدعي `POST /webhooks/shamcash` مع ترويسة `x-signature` = HMAC-SHA256 (hex) للجسم الخام بالسر `SHAM_WEBHOOK_SECRET`، وجسم JSON: `{ref, status:"paid", amount, txn}`.
- لا تُضاف الردود ولا يُحجز مبلغ الصفقة إلا من الـWebhook بعد التحقق من التوقيع والمبلغ.
- تحويل مستحقات المبدعين يدوي في البداية: اطلع على `payout_status='pending'` وحوّل، ثم سجّله عبر `/admin/orders/:id/payout-done`.

## ربط الواجهة
استبدل بيانات الواجهة التجريبية بطلبات `fetch` إلى هذه الواجهات، مع ترويسة `Authorization: Bearer <token>`. الواجهة تُنشر على دومين، ويوضع في `FRONTEND_ORIGIN`.

## الواجهات
- `POST /auth/register` `POST /auth/login` `GET|PUT /me`
- `GET|POST /gigs` `GET|POST /requests` `POST /requests/:id/bids` `POST /payments/bid-pack`
- `POST /orders` `GET /orders` `POST /orders/:id/{start,deliver,accept,dispute,review}`
- `GET /admin/{stats,disputes}` `POST /admin/disputes/:id/resolve` `POST /admin/users/:id/verify` `POST /admin/orders/:id/payout-done`

## قبل الإطلاق
- شروط الاستخدام وسياسة الخصوصية، ومراجعة قانونية لحفظ أموال الغير.
- نسخ احتياطي يومي لقاعدة البيانات، وتفعيل HTTPS.
- تفعيل التحقق بخطوتين على حساب الاستضافة وحساب الإيميل الإداري.
- اختبار تدفق الدفع كاملاً مع شام كاش على مبالغ صغيرة قبل الاعتماد.
