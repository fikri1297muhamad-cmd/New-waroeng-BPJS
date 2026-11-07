
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccount) {
    throw new Error('Firebase service account belum dikonfigurasi.');
  }

  return initializeApp({
    credential: cert(JSON.parse(serviceAccount))
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Metode tidak diizinkan.'
    });
  }

  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';

    if (!token) {
      return res.status(401).json({
        error: 'Silakan login sebagai Admin.'
      });
    }

    const decoded = await auth.verifyIdToken(token);
    const userId = decoded.uid;

    const profile = await db
      .collection('staff_profiles')
      .doc(userId)
      .get();

    if (!profile.exists || profile.data()?.role !== 'admin') {
      return res.status(403).json({
        error: 'Akses Admin ditolak.'
      });
    }

    const now = Date.now();

    const session = await db
      .collection('admin_access_sessions')
      .doc(userId)
      .get();

    const sessionData = session.data();
    const expiresAt = sessionData?.expiresAt;

    const validSession =
      sessionData?.active === true &&
      expiresAt &&
      typeof expiresAt.toMillis === 'function' &&
      expiresAt.toMillis() > now;

    if (
      decoded.adminAccess !== true ||
      Number(decoded.adminAccessUntil || 0) <= Math.floor(now / 1000) ||
      !validSession
    ) {
      return res.status(403).json({
        error: 'Sesi Admin tidak aktif atau sudah kedaluwarsa.'
      });
    }

    const collection = db.collection('restaurant_tables');

    const references = Array.from({ length: 50 }, (_, index) => {
      const number = index + 1;
      const id = `Meja ${String(number).padStart(2, '0')}`;

      return {
        id,
        number,
        ref: collection.doc(id)
      };
    });

    const snapshots = await Promise.all(
      references.map(item => item.ref.get())
    );

    const batch = db.batch();
    let created = 0;
    let alreadyExists = 0;

    references.forEach((item, index) => {
      if (snapshots[index].exists) {
        alreadyExists++;
        return;
      }

      batch.set(item.ref, {
        table_name: item.id,
        table_number: item.number,
        is_active: true
      });

      created++;
    });

    if (created > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      success: true,
      message: 'Pemeriksaan meja selesai.',
      created,
      alreadyExists,
      totalTables: 50
    });

  } catch (error) {
    console.error('Seed tables error:', error);

    return res.status(500).json({
      error: 'Gagal menyiapkan meja.'
    });
  }
}
