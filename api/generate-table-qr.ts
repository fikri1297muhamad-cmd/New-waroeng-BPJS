
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  getFirestore,
  FieldValue
} from 'firebase-admin/firestore';
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv
} from 'node:crypto';

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

function getEncryptionKey(): Buffer {
  const value = process.env.TABLE_QR_ENCRYPTION_KEY;

  if (!value) {
    throw new Error('QR_ENCRYPTION_KEY_MISSING');
  }

  const key = Buffer.from(value, 'base64');

  if (
    key.length !== 32 ||
    key.toString('base64') !== value
  ) {
    throw new Error('QR_ENCRYPTION_KEY_INVALID');
  }

  return key;
}

function hashToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

function encryptToken(token: string, key: Buffer) {
  const iv = randomBytes(12);

  const cipher = createCipheriv(
    'aes-256-gcm',
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final()
  ]);

  return {
    token_hash: hashToken(token),
    token_ciphertext: encrypted.toString('base64'),
    token_iv: iv.toString('base64'),
    token_auth_tag: cipher.getAuthTag().toString('base64'),
    token_version: 1
  };
}

function decryptToken(data: FirebaseFirestore.DocumentData, key: Buffer) {
  if (
    data.token_version !== 1 ||
    typeof data.token_ciphertext !== 'string' ||
    typeof data.token_iv !== 'string' ||
    typeof data.token_auth_tag !== 'string' ||
    typeof data.token_hash !== 'string'
  ) {
    throw new Error('QR_TOKEN_DATA_INVALID');
  }

  const iv = Buffer.from(data.token_iv, 'base64');
  const ciphertext = Buffer.from(
    data.token_ciphertext,
    'base64'
  );
  const authTag = Buffer.from(
    data.token_auth_tag,
    'base64'
  );

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error('QR_TOKEN_DATA_INVALID');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    iv
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');

  if (hashToken(decrypted) !== data.token_hash) {
    throw new Error('QR_TOKEN_DATA_INVALID');
  }

  return decrypted;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'Metode tidak diizinkan.'
    });
  }

  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);
    const encryptionKey = getEncryptionKey();

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

    const decoded = await auth.verifyIdToken(token, true);
    const userId = decoded.uid;

    const profile = await db
      .collection('staff_profiles')
      .doc(userId)
      .get();

    const role = String(
      profile.data()?.role || ''
    ).trim().toLowerCase();

    if (
      !profile.exists ||
      !['admin', 'admin 01'].includes(role)
    ) {
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
      Number(decoded.adminAccessUntil || 0) <=
        Math.floor(now / 1000) ||
      !validSession
    ) {
      return res.status(403).json({
        success: false,
        error: 'Sesi Admin tidak aktif atau sudah kedaluwarsa.'
      });
    }

    const tablesRef = db.collection('restaurant_tables');
    const qrRef = db.collection('table_qr_tokens');

    const rateLimitRef = db
      .collection('table_qr_api_limits')
      .doc(userId);

    const auditRef = db
      .collection('table_qr_audit')
      .doc();

    // Token dibuat sekali di luar transaksi.
    // Jika transaksi diulang oleh Firestore,
    // token yang digunakan tetap sama.
    const generatedTokens = Array.from(
      { length: 50 },
      () => randomBytes(32).toString('base64url')
    );

    const results = await db.runTransaction(
      async transaction => {
        const rateLimitSnapshot = await transaction.get(
          rateLimitRef
        );

        const lastRequest = rateLimitSnapshot.data()?.last_request_at;

        if (
          lastRequest &&
          typeof lastRequest.toMillis === 'function' &&
          now - lastRequest.toMillis() < 30000
        ) {
          throw new Error('QR_RATE_LIMITED');
        }

        
        // Siapkan referensi 50 meja dan 50 dokumen QR.
        const tableRefs = Array.from(
          { length: 50 },
          (_, index) =>
            tablesRef.doc(
              `Meja ${String(index + 1).padStart(2, '0')}`
            )
        );

        const qrRefs = Array.from(
          { length: 50 },
          (_, index) =>
            qrRef.doc(
              `Meja ${String(index + 1).padStart(2, '0')}`
            )
        );

        // Baca seluruh 100 dokumen secara berkelompok.
        const snapshots = await transaction.getAll(
          ...tableRefs,
          ...qrRefs
        );

        // Susun kembali hasil pembacaan berdasarkan nomor meja.
        const tableSnapshots = tableRefs.map(
          (tableDoc, index) => ({
            number: index + 1,
            tableId: `Meja ${String(index + 1).padStart(2, '0')}`,
            tableSnapshot: snapshots[index],
            qrSnapshot: snapshots[index + 50],
            qrDoc: qrRefs[index]
          })
        );

        const output = [];

        // Periksa semua meja sebelum menulis dokumen apa pun.
        for (const item of tableSnapshots) {
  if (!item.tableSnapshot.exists) {
    throw new Error(`${item.tableId}_TIDAK_DITEMUKAN`);
  }

  const tableData = item.tableSnapshot.data();

          if (
            tableData?.is_active !== true ||
            Number(tableData?.table_number) !== item.number
          ) {
            throw new Error(`${item.tableId}_TIDAK_AKTIF`);
          }

          if (item.qrSnapshot.exists) {
            const qrData = item.qrSnapshot.data();

            if (
              qrData?.is_active !== true ||
              Number(qrData?.table_number) !== item.number
            ) {
              throw new Error('QR_TOKEN_DATA_INVALID');
            }

            const existingToken = decryptToken(
              qrData,
              encryptionKey
            );

            output.push({
              tableNumber: item.number,
              token: existingToken,
              created: false
            });
          } else {
            const newToken = generatedTokens[item.number - 1];

            output.push({
              tableNumber: item.number,
              token: newToken,
              created: true
            });
          }
        }

        // Semua validasi selesai. Baru lakukan penulisan.
        for (const item of tableSnapshots) {
          if (!item.qrSnapshot.exists) {
            const newToken = generatedTokens[item.number - 1];

            transaction.create(item.qrDoc, {
              table_number: item.number,
              ...encryptToken(newToken, encryptionKey),
              is_active: true,
              created_at: FieldValue.serverTimestamp(),
              created_by: userId
            });
          }
        }

        const createdCount = output.filter(
          item => item.created
        ).length;

        transaction.set(rateLimitRef, {
          last_request_at: FieldValue.serverTimestamp()
        });

        transaction.create(auditRef, {
          action: 'generate_or_recover_table_qr',
          user_id: userId,
          total_tables: 50,
          created_count: createdCount,
          recovered_count: 50 - createdCount,
          created_at: FieldValue.serverTimestamp()
        });

        return output;
      }
    );

    return res.status(200).json({
      success: true,
      message: 'QR meja berhasil disiapkan.',
      totalTables: 50,
      created: results.filter(item => item.created).length,
      recovered: results.filter(item => !item.created).length,
      qrTokens: results.map(item => ({
        tableNumber: item.tableNumber,
        tableName: `Meja ${String(item.tableNumber).padStart(2, '0')}`,
        token: item.token
      }))
    });

  } catch (error) {
    console.error('Generate table QR error:', error);

    const message =
      error instanceof Error ? error.message : '';

    if (message === 'QR_RATE_LIMITED') {
      return res.status(429).json({
        success: false,
        error: 'Tunggu 30 detik sebelum meminta token QR kembali.'
      });
    }

    if (message.endsWith('_TIDAK_DITEMUKAN')) {
      return res.status(400).json({
        success: false,
        error: 'Ada data meja yang belum tersedia.'
      });
    }

    if (message.endsWith('_TIDAK_AKTIF')) {
      return res.status(400).json({
        success: false,
        error: 'Ada meja yang belum aktif atau datanya tidak sesuai.'
      });
    }

    if (message === 'QR_ENCRYPTION_KEY_MISSING') {
      return res.status(500).json({
        success: false,
        error: 'Kunci enkripsi QR belum dikonfigurasi.'
      });
    }

    if (message === 'QR_ENCRYPTION_KEY_INVALID') {
      return res.status(500).json({
        success: false,
        error: 'Konfigurasi kunci enkripsi QR tidak valid.'
      });
    }

    if (message === 'QR_TOKEN_DATA_INVALID') {
      return res.status(500).json({
        success: false,
        error: 'Data QR lama tidak valid atau tidak dapat dipulihkan. Perlu pemeriksaan Admin.'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Gagal menyiapkan QR meja. Periksa konfigurasi server.'
    });
  }
}
