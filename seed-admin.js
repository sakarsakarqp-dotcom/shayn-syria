require('dotenv').config();
const bcrypt = require('bcryptjs'), db = require('./db');
(async () => {
  const { ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PHONE || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) throw new Error('عبّئ ADMIN_* في .env (كلمة المرور 12 حرفاً فأكثر)');
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await db.q(`INSERT INTO users(role,name,phone,email,pass_hash,verified) VALUES('admin','Admin',$1,$2,$3,true)
              ON CONFLICT (phone) DO NOTHING`, [ADMIN_PHONE, ADMIN_EMAIL, hash]);
  console.log('تم إنشاء حساب الإدارة. احذف ADMIN_PASSWORD من .env الآن.'); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
