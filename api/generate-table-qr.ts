
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes, createHash } from 'node:crypto';

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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
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
        success: false,
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
        success: false,
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
        success: false,
        error: 'Sesi Admin tidak aktif atau sudah kedaluwarsa.'
      });
    }

    const tablesRef = db.collection('restaurant_tables');
    const qrRef = db.collection('table_qr_tokens');

    const results = await Promise.all(
      Array.from({ length: 50 }, async (_, index) => {
        const tableNumber = index + 1;
        const tableId = `Meja ${String(tableNumber).padStart(2, '0')}`;

        const tableDoc = tablesRef.doc(tableId);
        const qrDoc = qrRef.doc(tableId);

        const newToken = randomBytes(32).toString('base64url');

        const tokenHash = createHash('sha256')
          .update(newToken)
          .digest('hex');

        return db.runTransaction(async transaction => {
          const tableSnapshot = await transaction.get(tableDoc);
          const qrSnapshot = await transaction.get(qrDoc);

          if (!tableSnapshot.exists) {
            throw new Error(`${tableId}_TIDAK_DITEMUKAN`);
          }

          if (tableSnapshot.data()?.is_active !== true) {
            throw new Error(`${tableId}_TIDAK_AKTIF`);
          }

          if (qrSnapshot.exists) {
            return {
              tableNumber,
              created: false
            };
          }

          transaction.create(qrDoc, {
            table_number: tableNumber,
            token_hash: tokenHash,
            is_active: true,
            created_at: FieldValue.serverTimestamp(),
            created_by: userId
          });

          return {
            tableNumber,
            created: true,
            qrToken: newToken
          };
        });
      })
    );

    const created = results.filter(item => item.created);
    const alreadyExists = results.length - created.length;

    return res.status(200).json({
      success: true,
      message: 'Pembuatan QR meja selesai.',
      totalTables: 50,
      created: created.length,
      alreadyExists,
      qrTokens: created.map(item => ({
        tableNumber: item.tableNumber,
        tableName: `Meja ${String(item.tableNumber).padStart(2, '0')}`,
        token: item.qrToken
      }))
    });

  } catch (error) {
    console.error('Generate table QR error:', error);

    const message =
      error instanceof Error ? error.message : '';

    if (message.endsWith('_TIDAK_DITEMUKAN')) {
      return res.status(400).json({
        success: false,
        error: `Data ${message.replace('_TIDAK_DITEMUKAN', '')} belum tersedia.`
      });
    }

    if (message.endsWith('_TIDAK_AKTIF')) {
      return res.status(400).json({
        success: false,
        error: `Data ${message.replace('_TIDAK_AKTIF', '')} sedang tidak aktif.`
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Gagal membuat QR meja.'
    });
  }
}
