import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  const existingApp = getApps().find(app => app.name === '[DEFAULT]');
  if (existingApp) return existingApp;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) throw new Error('Firebase service account belum dikonfigurasi.');

  const credentials = JSON.parse(serviceAccount);
  if (credentials.project_id !== 'waroeng-bpjs') {
    throw new Error('Firebase Project ID tidak sesuai.');
  }

  return initializeApp({
    credential: cert(credentials),
    projectId: credentials.project_id
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Metode tidak diizinkan.' });
  }

  try {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Sesi login tidak valid.' });
    }

    const token = authorization.slice(7).trim();
    if (!token || token.length > 5000) {
      return res.status(401).json({ success: false, error: 'Token login tidak valid.' });
    }

    const orderId = String(req.body?.order_id ?? '').trim();
    if (!orderId || orderId.length > 200) {
      return res.status(400).json({ success: false, error: 'Nomor pesanan tidak valid.' });
    }

    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const decoded = await auth.verifyIdToken(token, true);
    const adminId = decoded.uid;

    const [profileSnapshot, sessionSnapshot] = await Promise.all([
      db.collection('staff_profiles').doc(adminId).get(),
      db.collection('admin_access_sessions').doc(adminId).get()
    ]);

    const role = String(profileSnapshot.data()?.role ?? '').trim().toLowerCase();
    const session = sessionSnapshot.data();
    const expiresAt = session?.expiresAt?.toDate?.();
    const claimUntil = Number(decoded.adminAccessUntil ?? 0);

    if (
      !profileSnapshot.exists ||
      !['admin', 'admin 01'].includes(role) ||
      decoded.adminAccess !== true ||
      claimUntil <= Math.floor(Date.now() / 1000) ||
      session?.active !== true ||
      !(expiresAt instanceof Date) ||
      expiresAt.getTime() <= Date.now()
    ) {
      return res.status(403).json({
        success: false,
        error: 'Sesi akses Admin tidak aktif atau sudah kedaluwarsa.'
      });
    }

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnapshot = await orderRef.get();

    if (!orderSnapshot.exists) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
    }

    if (!orderSnapshot.data()?.admin_trashed_at) {
      return res.status(409).json({
        success: false,
        error: 'Pesanan tidak berada di Sampah. Penghapusan dibatalkan.'
      });
    }

    const itemsSnapshot = await db
      .collection('order_items')
      .where('order_id', '==', orderId)
      .get();

    if (itemsSnapshot.size > 499) {
      return res.status(409).json({
        success: false,
        error: 'Jumlah rincian pesanan melebihi batas aman penghapusan sekaligus.'
      });
    }

    const batch = db.batch();
    itemsSnapshot.docs.forEach(item => batch.delete(item.ref));
    batch.delete(orderRef);
    await batch.commit();

    return res.status(200).json({
      success: true,
      deletedItems: itemsSnapshot.size
    });
  } catch (error: any) {
    const code = String(error?.code ?? '');
    console.error('Delete trashed order error:', code || 'UNKNOWN');

    return res.status(500).json({
      success: false,
      error: 'Pesanan gagal dihapus permanen.'
    });
  }
}
