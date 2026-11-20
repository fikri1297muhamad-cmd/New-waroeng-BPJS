import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { timingSafeEqual } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SESSION_MS = 15 * 60 * 1000;
const MAX_TOKEN_LENGTH = 5000;

function getAdminApp() {
  const existingApp = getApps().find(
    app => app.name === '[DEFAULT]'
  );

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

function safeCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');

  return (
    aBuffer.length === bBuffer.length &&
    timingSafeEqual(aBuffer, bBuffer)
  );
}

function validNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

async function recordFailedAttempt(
  db: FirebaseFirestore.Firestore,
  userId: string
) {
  const ref = db.collection('admin_access_attempts').doc(userId);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const data = snapshot.data();

    const lockedUntil = validNumber(data?.lockedUntil)
      ? data.lockedUntil
      : 0;

    if (lockedUntil > now) return true;

    const previousWindowStartedAt =
      validNumber(data?.windowStartedAt)
        ? data.windowStartedAt
        : 0;

    const oldCount = validNumber(data?.count)
      ? data.count
      : 0;

    const expired =
      previousWindowStartedAt === 0 ||
      now - previousWindowStartedAt > WINDOW_MS;

    const windowStartedAt = expired
      ? now
      : previousWindowStartedAt;

    const count = (expired ? 0 : oldCount) + 1;
    const locked = count >= MAX_ATTEMPTS;

    transaction.set(ref, {
      count,
      windowStartedAt,
      lockedUntil: locked ? now + WINDOW_MS : 0
    });

    return locked;
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
      error: 'Metode tidak diizinkan.'
    });
  }

  try {
    const authorization = req.headers.authorization;

    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      return res.status(401).json({
        error: 'Silakan login kembali.'
      });
    }

    const token = authorization.slice(7).trim();

    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return res.status(401).json({
        error: 'Token login tidak valid.'
      });
    }

    const body = req.body;

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      return res.status(400).json({
        error: 'Permintaan tidak valid.'
      });
    }

    const action = body.action;

    if (
      action === 'revoke' &&
      Object.keys(body).some(key => key !== 'action')
    ) {
      return res.status(400).json({
        error: 'Permintaan tidak valid.'
      });
    }

    if (
      action === 'verify' &&
      Object.keys(body).some(
        key => key !== 'action' && key !== 'code'
      )
    ) {
      return res.status(400).json({
        error: 'Permintaan tidak valid.'
      });
    }

    if (action !== 'verify' && action !== 'revoke') {
      return res.status(400).json({
        error: 'Permintaan tidak valid.'
      });
    }

    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const decoded = await auth.verifyIdToken(token, true);
    const userId = decoded.uid;

    const profile = await db
      .collection('staff_profiles')
      .doc(userId)
      .get();

    const role = String(profile.data()?.role ?? '')
      .trim()
      .toLowerCase();

    if (
      !profile.exists ||
      !['admin', 'admin 01'].includes(role)
    ) {
      return res.status(403).json({
        error: 'Akses Admin ditolak.'
      });
    }

    const sessionRef = db
      .collection('admin_access_sessions')
      .doc(userId);

    if (action === 'revoke') {
      const user = await auth.getUser(userId);
      const claims = { ...(user.customClaims || {}) };

      delete claims.adminAccess;
      delete claims.adminAccessUntil;

      await sessionRef.set({
        active: false,
        expiresAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });

      await auth.setCustomUserClaims(userId, claims);
      await auth.revokeRefreshTokens(userId);

      return res.status(200).json({
        success: true
      });
    }

    const accessCode = body.code;
    const secretCode = process.env.ADMIN_ACCESS_CODE;

    if (
      typeof accessCode !== 'string' ||
      typeof secretCode !== 'string' ||
      !secretCode ||
      secretCode.length > 256 ||
      accessCode.length > 256
    ) {
      return res.status(401).json({
        error: 'Kode akses tidak valid.'
      });
    }

    const attemptRef = db
      .collection('admin_access_attempts')
      .doc(userId);

    const attemptSnapshot = await attemptRef.get();
    const storedLock = attemptSnapshot.data()?.lockedUntil;
    const lockedUntil = validNumber(storedLock)
      ? storedLock
      : 0;

    if (lockedUntil > Date.now()) {
      return res.status(429).json({
        error: 'Terlalu banyak percobaan. Coba kembali setelah 15 menit.'
      });
    }

    if (!safeCompare(accessCode, secretCode)) {
      const locked = await recordFailedAttempt(db, userId);

      return res.status(locked ? 429 : 401).json({
        error: locked
          ? 'Terlalu banyak percobaan. Akses dikunci selama 15 menit.'
          : 'Kode akses Admin salah.'
      });
    }

    const now = Date.now();
    const expiresAt = new Date(now + SESSION_MS);

    // Nonaktifkan sesi lama terlebih dahulu.
    await sessionRef.set({
      active: false,
      expiresAt: new Date(now),
      updatedAt: new Date(now)
    }, { merge: true });

    try {
      const user = await auth.getUser(userId);

      await auth.setCustomUserClaims(userId, {
        ...(user.customClaims || {}),
        adminAccess: true,
        adminAccessUntil: Math.floor(
          (now + SESSION_MS) / 1000
        )
      });

      // Aktifkan sesi setelah klaim berhasil disimpan.
      await sessionRef.set({
        active: true,
        expiresAt,
        updatedAt: new Date(now)
      });
    } catch (error) {
      try {
        await sessionRef.set({
          active: false,
          expiresAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
      } catch (sessionError) {
        console.error('Gagal menonaktifkan sesi Admin:', sessionError);
      }
      throw error;
    }

    // Hapus catatan percobaan setelah sesi aktif.
    try {
      await attemptRef.delete();
    } catch (error) {
      console.error('Gagal menghapus catatan percobaan Admin:', error);
    }

    return res.status(200).json({
      success: true
    });

  } catch (error) {
    console.error('Admin access error:', error);

    return res.status(500).json({
      error: 'Pemeriksaan akses gagal. Silakan coba kembali.'
    });
  }
}
