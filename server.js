require('dotenv').config();
const express = require('express'), helmet = require('helmet'), cors = require('cors');
const rateLimit = require('express-rate-limit'), bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'), crypto = require('crypto');
const db = require('./db'), sham = require('./shamcash');

const { JWT_SECRET, SHAM_WEBHOOK_SECRET, FRONTEND_ORIGIN, PORT = 3000 } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be 32+ chars');

const COMMISSION = 0.08, FREE_BIDS = 3, PACK = { price: 5, bids: 10 };
const PKG = { basic: 1, standard: 1.8, premium: 3 };

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: FRONTEND_ORIGIN }));

const wrap = f => (req, res, next) => f(req, res).catch(next);
const sign = u => jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
const auth = (...roles) => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET);
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  } catch { res.status(401).json({ error: 'unauthorized' }); }
};
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

/* ---------- Webhook شام كاش (يحتاج الجسم الخام للتحقق من التوقيع) ---------- */
app.post('/webhooks/shamcash', express.raw({ type: '*/*' }), wrap(async (req, res) => {
  const sig = Buffer.from(req.headers['x-signature'] || '', 'hex');
  const mac = crypto.createHmac('sha256', SHAM_WEBHOOK_SECRET || '').update(req.body).digest();
  if (!SHAM_WEBHOOK_SECRET || sig.length !== mac.length || !crypto.timingSafeEqual(sig, mac)) return res.sendStatus(401);
  const ev = JSON.parse(req.body.toString());               // { ref, status, amount, txn }
  await db.tx(async c => {
    const { rows: [p] } = await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [ev.ref]);
    if (!p || p.status !== 'pending') return;                // تجاهل التكرار (idempotent)
    if (ev.status !== 'paid' || Number(ev.amount) !== Number(p.amount)) {
      await c.query("UPDATE payments SET status='failed' WHERE id=$1", [p.id]); return;
    }
    await c.query("UPDATE payments SET status='paid', provider_txn=$2 WHERE id=$1", [p.id, ev.txn]);
    if (p.purpose === 'bid_pack') await c.query('UPDATE users SET bid_credits=bid_credits+$2 WHERE id=$1', [p.user_id, PACK.bids]);
    if (p.purpose === 'escrow') await c.query("UPDATE orders SET status='held',updated_at=now() WHERE id=$1 AND status='pending_payment'", [p.order_id]);
  });
  res.sendStatus(200);
}));

app.use(express.json({ limit: '100kb' }));

/* ---------- الحسابات ---------- */
app.post('/auth/register', authLimiter, wrap(async (req, res) => {
  const { name, phone, password, role } = req.body;
  if (!name || !/^\+?\d{8,15}$/.test(phone || '') || (password || '').length < 8 || !['creator', 'company'].includes(role))
    return res.status(400).json({ error: 'invalid input' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows: [u] } = await db.q(
      'INSERT INTO users(name,phone,pass_hash,role,bid_credits) VALUES($1,$2,$3,$4,$5) RETURNING id,role,name,bid_credits',
      [name.trim(), phone, hash, role, role === 'creator' ? FREE_BIDS : 0]);
    res.json({ token: sign(u), user: u });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'phone exists' }); throw e; }
}));
app.post('/auth/login', authLimiter, wrap(async (req, res) => {
  const { rows: [u] } = await db.q('SELECT * FROM users WHERE phone=$1', [req.body.phone || '']);
  if (!u || !(await bcrypt.compare(req.body.password || '', u.pass_hash))) return res.status(401).json({ error: 'bad credentials' });
  res.json({ token: sign(u), user: { id: u.id, role: u.role, name: u.name, bid_credits: u.bid_credits } });
}));
app.get('/me', auth(), wrap(async (req, res) => {
  const { rows: [u] } = await db.q('SELECT id,role,name,phone,bio,skills,city,verified,bid_credits FROM users WHERE id=$1', [req.user.id]);
  res.json(u);
}));
app.put('/me', auth('creator'), wrap(async (req, res) => {
  const { bio, skills, city } = req.body;
  await db.q('UPDATE users SET bio=$2,skills=$3,city=$4 WHERE id=$1', [req.user.id, bio || '', skills || '', city || '']);
  res.json({ ok: true });
}));

/* ---------- الخدمات والطلبات والعروض ---------- */
app.get('/gigs', wrap(async (req, res) => {
  const { rows } = await db.q(`SELECT g.*, u.name creator_name, u.city, u.verified,
    (SELECT round(avg(rating),1) FROM reviews r WHERE r.creator_id=g.creator_id) rating
    FROM gigs g JOIN users u ON u.id=g.creator_id WHERE g.active ORDER BY g.created_at DESC LIMIT 100`);
  res.json(rows);
}));
app.post('/gigs', auth('creator'), wrap(async (req, res) => {
  const { title, category, base_price, delivery_days } = req.body;
  if (!title || !category || !(base_price > 0)) return res.status(400).json({ error: 'invalid input' });
  const { rows: [g] } = await db.q('INSERT INTO gigs(creator_id,title,category,base_price,delivery_days) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, title, category, base_price, delivery_days || 3]);
  res.json(g);
}));
app.get('/requests', wrap(async (req, res) => {
  const { rows } = await db.q(`SELECT r.*, u.name company_name, (SELECT count(*) FROM bids b WHERE b.request_id=r.id) bids_count
    FROM requests r JOIN users u ON u.id=r.company_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 100`);
  res.json(rows);
}));
app.post('/requests', auth('company'), wrap(async (req, res) => {
  const { title, category, budget } = req.body;
  if (!title || !category) return res.status(400).json({ error: 'invalid input' });
  const { rows: [r] } = await db.q('INSERT INTO requests(company_id,title,category,budget) VALUES($1,$2,$3,$4) RETURNING *',
    [req.user.id, title, category, budget || null]);
  res.json(r);
}));
// الرد على طلب: يخصم رداً واحداً بشكل ذري، فلا يمكن تجاوز الحد بطلبات متزامنة
app.post('/requests/:id/bids', auth('creator'), wrap(async (req, res) => {
  const { price, message } = req.body;
  if (!(price > 0)) return res.status(400).json({ error: 'invalid price' });
  try {
    const out = await db.tx(async c => {
      if (!(await c.query("SELECT 1 FROM requests WHERE id=$1 AND status='open'", [req.params.id])).rowCount) return { code: 404 };
      const u = await c.query('UPDATE users SET bid_credits=bid_credits-1 WHERE id=$1 AND bid_credits>0 RETURNING bid_credits', [req.user.id]);
      if (!u.rowCount) return { code: 402 };
      await c.query('INSERT INTO bids(request_id,creator_id,price,message) VALUES($1,$2,$3,$4)', [req.params.id, req.user.id, price, message || '']);
      return { code: 200, left: u.rows[0].bid_credits };
    });
    if (out.code === 402) return res.status(402).json({ error: 'no credits', pack: PACK });
    if (out.code === 404) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, credits_left: out.left });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'already bid' }); throw e; }
}));
app.post('/payments/bid-pack', auth('creator'), wrap(async (req, res) => {
  const { rows: [p] } = await db.q("INSERT INTO payments(user_id,purpose,amount) VALUES($1,'bid_pack',$2) RETURNING id", [req.user.id, PACK.price]);
  const ch = await sham.createCharge({ amount: PACK.price, ref: p.id, phone: null });
  res.json({ payment_id: p.id, pay_url: ch.pay_url });
}));

/* ---------- الصفقات والضمان ---------- */
app.post('/orders', auth(), wrap(async (req, res) => {
  const { rows: [g] } = await db.q('SELECT * FROM gigs WHERE id=$1 AND active', [req.body.gig_id]);
  const k = PKG[req.body.package || 'basic'];
  if (!g || !k || g.creator_id === req.user.id) return res.status(400).json({ error: 'invalid order' });
  const amount = Math.round(g.base_price * k * 100) / 100;   // السعر يُحسب في الخادم فقط
  const out = await db.tx(async c => {
    const { rows: [o] } = await c.query('INSERT INTO orders(gig_id,buyer_id,seller_id,package,amount) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [g.id, req.user.id, g.creator_id, req.body.package || 'basic', amount]);
    const { rows: [p] } = await c.query("INSERT INTO payments(user_id,purpose,order_id,amount) VALUES($1,'escrow',$2,$3) RETURNING id", [req.user.id, o.id, amount]);
    return { o, p };
  });
  const ch = await sham.createCharge({ amount, ref: out.p.id, phone: null });
  res.json({ order: out.o, pay_url: ch.pay_url });
}));
app.get('/orders', auth(), wrap(async (req, res) => {
  const { rows } = await db.q('SELECT * FROM orders WHERE buyer_id=$1 OR seller_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
}));
// انتقال الحالة: كل خطوة تتحقق من الدور والحالة السابقة
const step = (path, who, from, to) => app.post(`/orders/:id/${path}`, auth(), wrap(async (req, res) => {
  const r = await db.q(`UPDATE orders SET status=$1,updated_at=now() WHERE id=$2 AND ${who}=$3 AND status=$4 RETURNING *`, [to, req.params.id, req.user.id, from]);
  r.rowCount ? res.json(r.rows[0]) : res.status(409).json({ error: 'invalid transition' });
}));
step('start', 'seller_id', 'held', 'in_progress');
step('deliver', 'seller_id', 'in_progress', 'delivered');
const complete = (c, id) => c.query(`UPDATE orders SET status='completed', fee=round(amount*${COMMISSION},2),
  payout=amount-round(amount*${COMMISSION},2), payout_status='pending', updated_at=now() WHERE id=$1 RETURNING *`, [id]);
app.post('/orders/:id/accept', auth(), wrap(async (req, res) => {
  const o = await db.tx(async c => {
    const r = await c.query("SELECT 1 FROM orders WHERE id=$1 AND buyer_id=$2 AND status='delivered' FOR UPDATE", [req.params.id, req.user.id]);
    return r.rowCount ? (await complete(c, req.params.id)).rows[0] : null;
  });
  o ? res.json(o) : res.status(409).json({ error: 'invalid transition' });
}));
app.post('/orders/:id/dispute', auth(), wrap(async (req, res) => {
  const { reason, details } = req.body;
  const r = await db.q(`UPDATE orders SET status='disputed',dispute_reason=$3,dispute_details=$4,updated_at=now()
    WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2) AND status IN ('held','in_progress','delivered') RETURNING *`,
    [req.params.id, req.user.id, reason || '', details || '']);
  r.rowCount ? res.json(r.rows[0]) : res.status(409).json({ error: 'invalid transition' });
}));
app.post('/orders/:id/review', auth(), wrap(async (req, res) => {
  const { rating, comment } = req.body;
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'invalid rating' });
  try {
    const r = await db.q(`INSERT INTO reviews(order_id,reviewer_id,creator_id,rating,comment)
      SELECT id,$2,seller_id,$3,$4 FROM orders WHERE id=$1 AND buyer_id=$2 AND status='completed' RETURNING id`,
      [req.params.id, req.user.id, rating, comment || '']);
    r.rowCount ? res.json({ ok: true }) : res.status(409).json({ error: 'not allowed' });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'already reviewed' }); throw e; }
}));

/* ---------- الإدارة (محمية بالدور admin من التوكن) ---------- */
const admin = auth('admin');
app.get('/admin/stats', admin, wrap(async (req, res) => {
  const { rows: [s] } = await db.q(`SELECT count(*) orders,
    coalesce(sum(amount) FILTER (WHERE status IN ('held','in_progress','delivered','disputed')),0) held,
    coalesce(sum(fee) FILTER (WHERE status='completed'),0) commission,
    coalesce(sum(payout) FILTER (WHERE payout_status='pending'),0) payouts_due FROM orders`);
  res.json(s);
}));
app.get('/admin/disputes', admin, wrap(async (req, res) => res.json((await db.q("SELECT * FROM orders WHERE status='disputed' ORDER BY updated_at")).rows)));
app.post('/admin/disputes/:id/resolve', admin, wrap(async (req, res) => {
  const { action } = req.body;                               // 'release' للمبدع | 'refund' للعميل
  const o = await db.tx(async c => {
    if (!(await c.query("SELECT 1 FROM orders WHERE id=$1 AND status='disputed' FOR UPDATE", [req.params.id])).rowCount) return null;
    if (action === 'release') return (await complete(c, req.params.id)).rows[0];
    if (action === 'refund') return (await c.query("UPDATE orders SET status='refunded',updated_at=now() WHERE id=$1 RETURNING *", [req.params.id])).rows[0];
    return null;
  });
  o ? res.json(o) : res.status(409).json({ error: 'cannot resolve' });
}));
app.post('/admin/users/:id/verify', admin, wrap(async (req, res) => {
  await db.q('UPDATE users SET verified=$2 WHERE id=$1', [req.params.id, req.body.verified !== false]); res.json({ ok: true });
}));
// بعد تحويل المبلغ للمبدع يدوياً عبر شام كاش، سجّل ذلك هنا
app.post('/admin/orders/:id/payout-done', admin, wrap(async (req, res) => {
  const r = await db.q("UPDATE orders SET payout_status='paid' WHERE id=$1 AND payout_status='pending' RETURNING id", [req.params.id]);
  r.rowCount ? res.json({ ok: true }) : res.status(409).json({ error: 'nothing to mark' });
}));

app.get('/health', (_, res) => res.json({ ok: true }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'server error' }); });
app.listen(PORT, () => console.log('Shayn API on :' + PORT));
