import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function getAdminApp() {
  const existingApp = getApps().find(app => app.name === '[DEFAULT]');
  if (existingApp) return existingApp;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    throw new Error('Firebase service account belum dikonfigurasi.');
  }

  const credentials = JSON.parse(serviceAccount);
  if (credentials.project_id !== 'waroeng-bpjs') {
    throw new Error('Firebase Project ID tidak sesuai.');
  }

  return initializeApp({
    credential: cert(credentials),
    projectId: credentials.project_id
  });
}

export default async function handler(
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

  let createdUserId = '';

  try {
    const authorization = req.headers.authorization;

    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      return res.status(401).json({
        success: false,
        error: 'Sesi login tidak valid.'
      });
    }

    const token = authorization.slice(7).trim();

    if (!token || token.length > 5000) {
      return res.status(401).json({
        success: false,
        error: 'Token login tidak valid.'
      });
    }

    const body = req.body;

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some(
        key => !['full_name', 'email', 'password'].includes(key)
      )
    ) {
      return res.status(400).json({
        success: false,
        error: 'Data akun tidak valid.'
      });
    }

    const fullName =
      typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password =
      typeof body.password === 'string' ? body.password : '';

    if (fullName.length < 2 || fullName.length > 80) {
      return res.status(400).json({
        success: false,
        error: 'Nama lengkap harus 2–80 karakter.'
      });
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        success: false,
        error: 'Format email tidak valid.'
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'Kata sandi harus 8–128 karakter.'
      });
    }

    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const decoded = await auth.verifyIdToken(token, true);
    const adminId = decoded.uid;

    const profileRef = db.collection('staff_profiles').doc(adminId);
    const sessionRef = db.collection('admin_access_sessions').doc(adminId);

    const [profileSnapshot, sessionSnapshot] = await Promise.all([
      profileRef.get(),
      sessionRef.get()
    ]);

    const role = String(profileSnapshot.data()?.role ?? '')
      .trim()
      .toLowerCase();

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

    const user = await auth.createUser({
      email,
      password,
      displayName: fullName,
      disabled: false
    });

    createdUserId = user.uid;

    await db.collection('staff_profiles').doc(user.uid).create({
      full_name: fullName,
      role: 'kasir',
      created_at: FieldValue.serverTimestamp()
    });

    return res.status(201).json({
      success: true,
      message: 'Akun kasir berhasil dibuat.',
      account: {
        uid: user.uid,
        full_name: fullName,
        email,
        role: 'kasir'
      }
    });
  } catch (error: any) {
    if (createdUserId) {
      try {
        const app = getAdminApp();
        await getAuth(app).deleteUser(createdUserId);
      } catch (rollbackError) {
        console.error('Pembersihan akun gagal:', rollbackError);
      }
    }

    const code = String(error?.code ?? '');

    if (code === 'auth/email-already-exists') {
      return res.status(409).json({
        success: false,
        error: 'Email tersebut sudah digunakan.'
      });
    }

    if (
      code === 'auth/invalid-email' ||
      code === 'auth/invalid-password'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Email atau kata sandi tidak memenuhi ketentuan.'
      });
    }

    console.error('Create cashier error:', code || 'UNKNOWN');

    return res.status(500).json({
      success: false,
      error: 'Akun kasir gagal dibuat. Silakan coba kembali.'
    });
  }
}
