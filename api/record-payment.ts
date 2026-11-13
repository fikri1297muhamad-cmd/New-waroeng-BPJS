import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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

    const decodedToken = await auth.verifyIdToken(idToken);

    const profileSnapshot = await db
      .collection('staff_profiles')
      .doc(decodedToken.uid)
      .get();

    if (!profileSnapshot.exists) {
      return res.status(403).json({
        success: false,
        error: 'Akses hanya untuk staf Waroeng BPJS.'
      });
    }

    const role = String(
      profileSnapshot.data()?.role ?? ''
    ).trim().toLowerCase();

    if (!['admin', 'admin 01', 'kasir'].includes(role)) {
      return res.status(403).json({
        success: false,
        error: 'Anda tidak memiliki izin mencatat pembayaran.'
      });
    }

    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({
        success: false,
        error: 'Data pembayaran tidak valid.'
      });
    }

    const orderId =
      typeof body.order_id === 'string'
        ? body.order_id.trim()
        : '';

    const paymentMethod =
      typeof body.payment_method === 'string'
        ? body.payment_method.trim().toLowerCase()
        : '';

    if (
      !orderId ||
      orderId.length > 150 ||
      !/^[A-Za-z0-9_-]+$/.test(orderId)
    ) {
      return res.status(400).json({
        success: false,
        error: 'Nomor pesanan tidak valid.'
      });
    }

    if (!['tunai', 'non_tunai'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        error: 'Metode pembayaran harus Tunai atau Non-Tunai.'
      });
    }

    const orderRef = db.collection('orders').doc(orderId);

    const result = await db.runTransaction(async transaction => {
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists) {
        throw new Error('PESANAN_TIDAK_DITEMUKAN');
      }

      const order = orderSnapshot.data();

      if (order?.payment_status !== 'belum_lunas') {
        throw new Error('PESANAN_SUDAH_DIPROSES');
      }

      const totalAmount = Number(order?.total_amount);

      if (
        !Number.isSafeInteger(totalAmount) ||
        totalAmount < 0
      ) {
        throw new Error('TOTAL_PESANAN_TIDAK_VALID');
      }

      transaction.update(orderRef, {
        payment_status: 'lunas',
        payment_method: paymentMethod,
        paid_at: FieldValue.serverTimestamp(),
        paid_by: decodedToken.uid
      });

      return {
        order_id: orderId,
        order_code: String(order?.order_code ?? ''),
        total_amount: totalAmount,
        payment_method: paymentMethod
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Pembayaran berhasil dicatat.',
      payment: result
    });

  } catch (error) {
    const message =
      error instanceof Error ? error.message : '';

    const knownErrors: Record<string, string> = {
      PESANAN_TIDAK_DITEMUKAN: 'Pesanan tidak ditemukan.',
      PESANAN_SUDAH_DIPROSES: 'Pesanan sudah lunas atau sudah diproses sebelumnya.',
      TOTAL_PESANAN_TIDAK_VALID: 'Total pembayaran pada pesanan tidak valid.'
    };

    if (knownErrors[message]) {
      const status =
        message === 'PESANAN_TIDAK_DITEMUKAN'
          ? 404
          : message === 'PESANAN_SUDAH_DIPROSES'
            ? 409
            : 400;

      return res.status(status).json({
        success: false,
        error: knownErrors[message]
      });
    }

    console.error(
      'Record payment error:',
      message || 'Unknown error'
    );

    return res.status(500).json({
      success: false,
      error: 'Pembayaran gagal dicatat. Silakan coba kembali.'
    });
  }
}

