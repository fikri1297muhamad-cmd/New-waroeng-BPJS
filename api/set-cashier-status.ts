import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  const existing = getApps().find((app) => app.name === 'waroeng-bpjs-admin');
  if (existing) return existing;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('SERVICE_ACCOUNT_MISSING');

  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.project_id !== 'waroeng-bpjs') {
    throw new Error('PROJECT_ID_INVALID');
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: 'waroeng-bpjs'
  }, 'waroeng-bpjs-admin');
}

export default async function setCashierStatusHandler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Metode tidak diizinkan.'
    });
  }

  try {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Sesi Admin tidak ditemukan.'
      });
    }

    const { uid, disabled } = req.body || {};

    if (typeof uid !== 'string' || !uid.trim() || typeof disabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'UID akun dan status yang valid wajib diisi.'
      });
    }

    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const decoded = await auth.verifyIdToken(token, true);
    const adminProfile = await db.collection('staff_profiles').doc(decoded.uid).get();
    const adminSession = await db.collection('admin_access_sessions').doc(decoded.uid).get();

    const sessionData = adminSession.data();
    const expiresAt = sessionData?.expiresAt?.toDate
      ? sessionData.expiresAt.toDate().getTime()
      : sessionData?.expiresAt instanceof Date
        ? sessionData.expiresAt.getTime()
        : 0;

    const adminRole = String(adminProfile.data()?.role || '').trim().toLowerCase();

    if (
      !adminProfile.exists ||
      !['admin', 'admin 01'].includes(adminRole) ||
      decoded.adminAccess !== true ||
      Number(decoded.adminAccessUntil || 0) * 1000 <= Date.now() ||
      sessionData?.active !== true ||
      expiresAt <= Date.now()
    ) {
      return res.status(403).json({
        success: false,
        error: 'Akses pengelolaan akun tidak diizinkan atau telah berakhir.'
      });
    }

    const profile = await db.collection('staff_profiles').doc(uid.trim()).get();

    if (
      !profile.exists ||
      String(profile.data()?.role || '').trim().toLowerCase() !== 'kasir'
    ) {
      return res.status(403).json({
        success: false,
        error: 'Fitur ini hanya dapat mengubah status akun dengan role kasir.'
      });
    }

    await auth.updateUser(uid.trim(), { disabled });

    return res.status(200).json({
      success: true,
      disabled,
      message: disabled
        ? 'Akun kasir berhasil dinonaktifkan.'
        : 'Akun kasir berhasil diaktifkan kembali.'
    });
  } catch (error: any) {
    const code = String(error?.code || '');

    if (code === 'auth/user-not-found') {
      return res.status(404).json({
        success: false,
        error: 'Akun kasir tidak ditemukan.'
      });
    }

    console.error('Set cashier status failed:', code || 'UNKNOWN_ERROR');
    return res.status(500).json({
      success: false,
      error: 'Status akun kasir gagal diperbarui.'
    });
  }
}
