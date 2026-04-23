/**
 * Optimal Log — ショートカット用体重受信APIエンドポイント
 *
 * ホスティング: Vercel (無料プラン OK)
 * パス: /api/log-weight
 *
 * iPhoneショートカットから POST リクエストを受け取り、
 * Firebase Firestore に体重データを書き込む。
 *
 * ── 必要な環境変数（Vercel Dashboard → Settings → Environment Variables）──
 *   FIREBASE_SERVICE_ACCOUNT_JSON  : Firebaseサービスアカウントキー（JSON文字列）
 *   SHORTCUT_SECRET                : 任意の秘密キー（ショートカットのURLに含める）
 *   USER_UID                       : FirebaseのユーザーUID（Firebaseコンソール → Authentication で確認）
 *
 * ── リクエスト例（iPhoneショートカット）──
 *   URL    : https://your-project.vercel.app/api/log-weight?secret=YOUR_SECRET
 *   Method : POST
 *   Body   : weight=73.5&fat=18.5&muscle=35.0&visceral=8&date=2026/04/19
 *   ※ fat, muscle, visceral, date は省略可
 *
 * ── レスポンス ──
 *   成功: "Success: 2026-04-19"
 *   失敗: "Error: ..."
 */

const admin = require('firebase-admin');

// Firebase Admin 初期化（コールドスタート時のみ）
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

module.exports = async (req, res) => {
  // CORS ヘッダー（必要に応じて）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST のみ受け付け
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // 秘密キー検証
  const { secret } = req.query;
  if (secret !== process.env.SHORTCUT_SECRET) {
    return res.status(403).send('Forbidden');
  }

  const uid = process.env.USER_UID;
  if (!uid) {
    return res.status(500).send('Error: USER_UID not configured');
  }

  // パラメータ取得（クエリ or ボディ）
  const params = { ...req.query, ...req.body };
  const { weight, fat, muscle, visceral, bmi, date } = params;

  if (!weight || weight === '') {
    return res.status(400).send('Error: No weight data received');
  }

  // 日付確定
  let docDate = new Date();
  if (date) {
    const m = String(date).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) docDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const docKey = [
    docDate.getFullYear(),
    String(docDate.getMonth() + 1).padStart(2, '0'),
    String(docDate.getDate()).padStart(2, '0'),
  ].join('-'); // "2026-04-19"

  const db     = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  // 書き込みデータ組み立て
  const data = {};
  if (weight)   data.weight   = Number(weight);
  if (fat       && fat       !== '') data.fat      = Number(fat);
  if (muscle    && muscle    !== '') data.muscle   = Number(muscle);
  if (visceral  && visceral  !== '') data.visceral = Number(visceral);

  // BMI自動計算（送られてこない場合は身長から算出）
  let bmiVal = (bmi && bmi !== '') ? Number(bmi) : null;
  if (!bmiVal && data.weight) {
    try {
      const settingsDoc = await userRef.collection('settings').doc('config').get();
      if (settingsDoc.exists) {
        const h = (settingsDoc.data().heightCm || 0) / 100;
        if (h > 0) bmiVal = Math.round(data.weight / (h * h) * 100) / 100;
      }
    } catch (e) { /* BMI計算失敗は無視 */ }
  }
  if (bmiVal) data.bmi = bmiVal;

  // Firestore に書き込み（既存レコードとマージ）
  await userRef.collection('metrics').doc(docKey).set(data, { merge: true });

  console.log(`[log-weight] Saved ${docKey}:`, data);
  return res.status(200).send('Success: ' + docKey);
};
