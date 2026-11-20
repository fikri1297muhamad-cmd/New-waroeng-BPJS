
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  createHash,
  timingSafeEqual
} from 'node:crypto';

import {
  initializeApp,
  cert,
  getApps
} from 'firebase-admin/app';

import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  const existingApp = getApps().find(
    app => app.name === '[DEFAULT]'
  );

  if (existingApp) return existingApp;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccount) {
    throw new Error('FIREBASE_CONFIG_MISSING');
  }

  const credentials = JSON.parse(serviceAccount);

  if (credentials.project_id !== 'waroeng-bpjs') {
    throw new Error('FIREBASE_PROJECT_MISMATCH');
  }

  return initializeApp({
    credential: cert(credentials),
    projectId: credentials.project_id
  });
}

function hashToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

function safeHashCompare(
  receivedHash: string,
  storedHash: string
): boolean {
  if (
    !/^[a-f0-9]{64}$/i.test(receivedHash) ||
    !/^[a-f0-9]{64}$/i.test(storedHash)
  ) {
    return false;
  }

  const received = Buffer.from(receivedHash, 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  return timingSafeEqual(received, stored);
}

async function checkRateLimit(
  db: FirebaseFirestore.Firestore,
  ip: string
) {
  const ipHash = hashToken(ip);

  const rateLimitRef = db
    .collection('table_qr_verify_limits')
    .doc(ipHash);

  const now = Date.now();
  const windowDuration = 60 * 1000;
  const maxRequests = 120;

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(rateLimitRef);
    const data = snapshot.data();

    const windowStartedAt = Number(
      data?.window_started_at || 0
    );

    const requestCount = Number(
      data?.request_count || 0
    );

    const sameWindow =
      windowStartedAt > 0 &&
      now - windowStartedAt < windowDuration;

    if (sameWindow && requestCount >= maxRequests) {
      return false;
    }

    transaction.set(rateLimitRef, {
      window_started_at: sameWindow
        ? windowStartedAt
        : now,
      request_count: sameWindow
        ? requestCount + 1
        : 1,
      updated_at: now
    });

    return true;
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
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'Metode tidak diizinkan.'
    });
  }

  const contentType = String(
    req.headers['content-type'] || ''
  ).toLowerCase();

  if (!contentType.includes('application/json')) {
    return res.status(415).json({
      success: false,
      error: 'Format permintaan tidak valid.'
    });
  }

  const contentLength = Number(
    req.headers['content-length'] || 0
  );

  if (
    !Number.isFinite(contentLength) ||
    contentLength > 4096
  ) {
    return res.status(413).json({
      success: false,
      error: 'Ukuran permintaan terlalu besar.'
    });
  }

  try {
    const body = req.body;

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      return res.status(400).json({
        success: false,
        error: 'Data permintaan tidak valid.'
      });
    }

    const tableNumber = Number(body.table_number);
    const token = body.token;

    if (
      !Number.isInteger(tableNumber) ||
      tableNumber < 1 ||
      tableNumber > 50
    ) {
      return res.status(400).json({
        success: false,
        error: 'Nomor meja tidak valid.'
      });
    }

    if (
      typeof token !== 'string' ||
      token.length !== 43 ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    ) {
      return res.status(400).json({
        success: false,
        error: 'QR meja tidak valid.'
      });
    }

    const forwardedFor =
      req.headers['x-forwarded-for'];

    const ip = (
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : ''
    );

    if (!ip) {
      return res.status(400).json({
        success: false,
        error: 'Permintaan tidak dapat diverifikasi.'
      });
    }

    const app = getAdminApp();
    const db = getFirestore(app);

    const allowed = await checkRateLimit(db, ip);

    if (!allowed) {
      res.setHeader('Retry-After', '60');

      return res.status(429).json({
        success: false,
        error: 'Terlalu banyak permintaan. Silakan coba lagi sebentar.'
      });
    }

    const tableId =
      `Meja ${String(tableNumber).padStart(2, '0')}`;

    const tableRef = db
      .collection('restaurant_tables')
      .doc(tableId);

    const qrRef = db
      .collection('table_qr_tokens')
      .doc(tableId);

    const [tableSnapshot, qrSnapshot] =
      await Promise.all([
        tableRef.get(),
        qrRef.get()
      ]);

    if (
      !tableSnapshot.exists ||
      !qrSnapshot.exists
    ) {
      return res.status(403).json({
        success: false,
        error: 'QR meja tidak terdaftar.'
      });
    }

    const tableData = tableSnapshot.data();
    const qrData = qrSnapshot.data();

    if (
      tableData?.is_active !== true ||
      Number(tableData?.table_number) !== tableNumber
    ) {
      return res.status(403).json({
        success: false,
        error: 'Meja tidak aktif.'
      });
    }

    if (
      qrData?.is_active !== true ||
      Number(qrData?.table_number) !== tableNumber ||
      qrData?.token_version !== 1 ||
      typeof qrData?.token_hash !== 'string'
    ) {
      return res.status(403).json({
        success: false,
        error: 'QR meja tidak aktif atau tidak valid.'
      });
    }

    const receivedHash = hashToken(token);

    const isValid = safeHashCompare(
      receivedHash,
      qrData.token_hash
    );

    if (!isValid) {
      return res.status(403).json({
        success: false,
        error: 'Token QR meja tidak cocok.'
      });
    }

    return res.status(200).json({
      success: true,
      table_number: tableNumber,
      verified: true
    });

  } catch (error) {
    console.error(
      'Verify table QR error:',
      error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR'
    );

    return res.status(500).json({
      success: false,
      error: 'Verifikasi QR gagal. Silakan coba kembali.'
    });
  }
}
