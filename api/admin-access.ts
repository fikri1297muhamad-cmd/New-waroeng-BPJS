
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { timingSafeEqual } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

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

function safeCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');

  return (
    aBuffer.length === bBuffer.length &&
    timingSafeEqual(aBuffer, bBuffer)
  );
}

async function recordFailedAttempt(db: FirebaseFirestore.Firestore, userId: string) {
  const ref = db.collection('admin_access_attempts').doc(userId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const data = snapshot.data();

    const lockedUntil = data?.lockedUntil || 0;

    if (lockedUntil > now) {
      return true;
    }

    const previousWindowStartedAt = data?.windowStartedAt || 0;

const expired =
  !previousWindowStartedAt ||
  now - previousWindowStartedAt > WINDOW_MS;

const windowStartedAt = expired
  ? now
  : previousWindowStartedAt;

const oldCount = expired
  ? 0
  : (data?.count || 0);
    const count = oldCount + 1;
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
        error: 'Silakan login kembali.'
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

    const action = req.body?.action;

    if (action === 'revoke') {
      const user = await auth.getUser(userId);
      const claims = { ...(user.customClaims || {}) };

      delete claims.adminAccess;
      delete claims.adminAccessUntil;

      await auth.setCustomUserClaims(userId, claims);
      await auth.revokeRefreshTokens(userId);

      return res.status(200).json({
        success: true
      });
    }

    if (action !== 'verify') {
      return res.status(400).json({
        error: 'Permintaan tidak valid.'
      });
    }

    const accessCode = req.body?.code;
    const secretCode = process.env.ADMIN_ACCESS_CODE;

    if (
      typeof accessCode !== 'string' ||
      typeof secretCode !== 'string' ||
      !secretCode ||
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
    const lockedUntil = attemptSnapshot.data()?.lockedUntil || 0;

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

    await attemptRef.delete();

    const user = await auth.getUser(userId);

    await auth.setCustomUserClaims(userId, {
      ...(user.customClaims || {}),
      adminAccess: true,
      adminAccessUntil: Math.floor(Date.now() / 1000) + 15 * 60
    });

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
