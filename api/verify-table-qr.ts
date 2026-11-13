
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { createHash, timingSafeEqual } from 'crypto';

import {
  cert,
  getApps,
  initializeApp
} from 'firebase-admin/app';

import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  const existingApps = getApps();

  if (existingApps.length > 0) {
    return existingApps[0];
  }

  const serviceAccountRaw =
    process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountRaw) {
    throw new Error('Server configuration error.');
  }

  const credentials = JSON.parse(serviceAccountRaw);

  if (credentials.project_id !== 'waroeng-bpjs') {
    throw new Error('Invalid Firebase project.');
  }

  return initializeApp({
    credential: cert(credentials),
    projectId: 'waroeng-bpjs'
  });
}

function hashToken(token: string) {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

function safeHashCompare(
  receivedHash: string,
  storedHash: string
) {
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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Cache-Control', 'no-store, private');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Metode tidak diizinkan.'
    });
  }

  try {
    const body = req.body ?? {};

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

    const app = getAdminApp();
    const db = getFirestore(app);

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

    if (!tableSnapshot.exists || !qrSnapshot.exists) {
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
  } catch {
    return res.status(500).json({
      success: false,
      error: 'Verifikasi QR gagal. Silakan coba kembali.'
    });
  }
}
