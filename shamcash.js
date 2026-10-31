// عدّل هذا الملف ليطابق واجهة باكند شام كاش الجاهز لديك (المسارات وشكل الطلب والرد).
const { SHAM_API_URL, SHAM_API_KEY } = process.env;
async function call(path, body) {
  if (!SHAM_API_URL) return { stub: true, pay_url: 'https://example.invalid/pay/' + body.ref }; // وضع تجريبي
  const r = await fetch(SHAM_API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SHAM_API_KEY },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('shamcash ' + r.status);
  return r.json();
}
// إنشاء طلب دفع؛ ref هو رقم سجل payments عندنا
exports.createCharge = ({ amount, ref, phone }) => call('/charges', { amount, currency: 'USD', ref, phone });
