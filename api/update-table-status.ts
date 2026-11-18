import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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

  try {
    const authorization = req.headers.authorization;

    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      return res.status(401).json({
        success: false,
        error: 'Sesi login tidak valid. Silakan login kembali.'
      });
    }

    const idToken = authorization.slice(7).trim();

    if (!idToken || idToken.length > 5000) {
      return res.status(401).json({
        success: false,
        error: 'Token login tidak valid.'
      });
    }

    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);
    const decodedToken = await auth.verifyIdToken(idToken, true);

    const profileSnapshot = await db
      .collection('staff_profiles')
      .doc(decodedToken.uid)
      .get();

    const role = String(
      profileSnapshot.data()?.role ?? ''
    ).trim().toLowerCase();

    if (
      !profileSnapshot.exists ||
      role !== 'kasir'
    ) {
      return res.status(403).json({
        success: false,
        error: 'Anda tidak memiliki izin mengubah status meja.'
      });
    }

    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({
        success: false,
        error: 'Data status meja tidak valid.'
      });
    }

    const tableNumber = Number(body.table_number);
    const targetStatus =
      typeof body.table_status === 'string'
        ? body.table_status.trim().toLowerCase()
        : '';

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

    if (!['perlu_dibersihkan', 'kosong'].includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Status meja tujuan tidak valid.'
      });
    }

    const tableId = `Meja ${String(tableNumber).padStart(2, '0')}`;
    const tableRef = db.collection('restaurant_tables').doc(tableId);

    await db.runTransaction(async transaction => {
      const tableSnapshot = await transaction.get(tableRef);

      if (!tableSnapshot.exists) {
        throw new Error('MEJA_TIDAK_DITEMUKAN');
      }

      const table = tableSnapshot.data();

      if (
        table?.is_active !== true ||
        Number(table?.table_number ?? table?.Table_number) !== tableNumber
      ) {
        throw new Error('MEJA_TIDAK_AKTIF');
      }

      const currentStatus = table?.table_status;

      const validTransition =
        (currentStatus === 'terisi' &&
          targetStatus === 'perlu_dibersihkan') ||
        (currentStatus === 'perlu_dibersihkan' &&
          targetStatus === 'kosong');

      if (!validTransition) {
        throw new Error('PERUBAHAN_STATUS_TIDAK_VALID');
      }

      const tableSessionId =
        typeof table?.table_session_id === 'string'
          ? table.table_session_id.trim()
          : '';

      if (targetStatus === 'kosong' && tableSessionId) {
        const ordersQuery = db
          .collection('orders')
          .where('table_session_id', '==', tableSessionId);

        const ordersSnapshot = await transaction.get(ordersQuery);

        const ordersToArchive = ordersSnapshot.docs.filter(
          orderDoc =>
            Number(orderDoc.data()?.table_number) === tableNumber &&
            !orderDoc.data()?.cashier_archived_at
        );

        if (ordersToArchive.length > 450) {
          throw new Error('TERLALU_BANYAK_PESANAN');
        }

        ordersToArchive.forEach(orderDoc => {
          transaction.update(orderDoc.ref, {
            cashier_archived_at: FieldValue.serverTimestamp(),
            cashier_archived_by: decodedToken.uid
          });
        });
      }

      transaction.update(tableRef, {
        table_status: targetStatus,
        table_status_updated_at: FieldValue.serverTimestamp(),
        table_status_updated_by: decodedToken.uid,
        ...(targetStatus === 'kosong'
          ? { table_session_id: FieldValue.delete() }
          : {})
      });
    });

    return res.status(200).json({
      success: true,
      message: 'Status meja berhasil diperbarui.',
      table_number: tableNumber,
      table_status: targetStatus
    });

  } catch (error) {
    const message =
      error instanceof Error ? error.message : '';

    const knownErrors: Record<string, string> = {
      MEJA_TIDAK_DITEMUKAN: 'Meja tidak ditemukan.',
      MEJA_TIDAK_AKTIF: 'Meja sedang tidak aktif.',
      PERUBAHAN_STATUS_TIDAK_VALID: 'Urutan perubahan status meja tidak valid. Muat ulang data meja.',
      TERLALU_BANYAK_PESANAN: 'Pesanan meja terlalu banyak untuk diarsipkan sekaligus. Hubungi Admin.'
    };

    if (knownErrors[message]) {
      const status =
        message === 'MEJA_TIDAK_DITEMUKAN'
          ? 404
          : message === 'PERUBAHAN_STATUS_TIDAK_VALID'
            ? 409
            : 400;

      return res.status(status).json({
        success: false,
        error: knownErrors[message]
      });
    }

    console.error(
      'Update table status error:',
      message || 'Unknown error'
    );

    return res.status(500).json({
      success: false,
      error: 'Status meja gagal diperbarui. Silakan coba kembali.'
    });
  }
}
