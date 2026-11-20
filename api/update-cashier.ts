import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

export default async function updateCashierHandler(
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

    const { uid, full_name, email, password } = req.body || {};

    if (
      typeof uid !== 'string' || !uid.trim() ||
      typeof full_name !== 'string' ||
      typeof email !== 'string' ||
      (password !== undefined && typeof password !== 'string')
    ) {
      return res.status(400).json({
        success: false,
        error: 'Data akun tidak lengkap atau tidak valid.'
      });
    }

    const name = full_name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        success: false,
        error: 'Nama harus terdiri dari 2 sampai 80 karakter.'
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Format email tidak valid.'
      });
    }

    if (password !== undefined && password !== '' &&
        (password.length < 8 || password.length > 128)) {
      return res.status(400).json({
        success: false,
        error: 'Kata sandi baru harus terdiri dari 8 sampai 128 karakter.'
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

    const profileRef = db.collection('staff_profiles').doc(uid.trim());
    const profile = await profileRef.get();

    if (!profile.exists ||
        String(profile.data()?.role || '').trim().toLowerCase() !== 'kasir') {
      return res.status(403).json({
        success: false,
        error: 'Fitur ini hanya dapat mengubah akun dengan role kasir.'
      });
    }

    const targetUser = await auth.getUser(uid.trim());
    const oldName = String(profile.data()?.full_name || '');
    const oldAuthName = targetUser.displayName || '';

    await profileRef.update({
      full_name: name,
      updated_at: FieldValue.serverTimestamp()
    });

    try {
      const authUpdates: {
        displayName: string;
        email: string;
        password?: string;
      } = {
        displayName: name,
        email: normalizedEmail
      };

      if (password) authUpdates.password = password;

      await auth.updateUser(uid.trim(), authUpdates);
    } catch (error) {
      await profileRef.update({ full_name: oldName });
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: 'Data akun kasir berhasil diperbarui.'
    });
  } catch (error: any) {
    const code = String(error?.code || '');

    if (code === 'auth/email-already-exists') {
      return res.status(409).json({
        success: false,
        error: 'Email tersebut sudah digunakan akun lain.'
      });
    }

    if (code === 'auth/invalid-email' || code === 'auth/invalid-password') {
      return res.status(400).json({
        success: false,
        error: 'Email atau kata sandi baru tidak valid.'
      });
    }

    if (code === 'auth/user-not-found') {
      return res.status(404).json({
        success: false,
        error: 'Akun kasir tidak ditemukan.'
      });
    }

    console.error('Update cashier failed:', code || 'UNKNOWN_ERROR');
    return res.status(500).json({
      success: false,
      error: 'Perubahan akun kasir gagal disimpan.'
    });
  }
}
