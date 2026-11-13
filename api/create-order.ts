import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

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

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function safeHashMatch(
  receivedToken: string,
  storedHash: unknown
): boolean {
  if (
    typeof storedHash !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(storedHash)
  ) {
    return false;
  }

  const receivedHash = hashToken(receivedToken);
  const expectedHash = Buffer.from(storedHash, 'hex');

  if (receivedHash.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(receivedHash, expectedHash);
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
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({
        success: false,
        error: 'Data pesanan tidak valid.'
      });
    }

    const customerName =
      typeof body.customer_name === 'string'
        ? body.customer_name.trim()
        : '';

    const tableNumber = Number(body.table_number);
    const tableQrToken =
      typeof body.table_qr_token === 'string'
        ? body.table_qr_token
        : '';

    const items = body.items;

    if (
      customerName.length < 2 ||
      customerName.length > 80
    ) {
      return res.status(400).json({
        success: false,
        error: 'Nama pemesan harus 2 sampai 80 karakter.'
      });
    }

    if (
      !Number.isInteger(tableNumber) ||
      tableNumber < 1 ||
      tableNumber > 50
    ) {
      return res.status(400).json({
        success: false,
        error: 'Nomor meja harus antara 01 sampai 50.'
      });
    }

    if (!/^[A-Za-z0-9_-]{43}$/.test(tableQrToken)) {
      return res.status(400).json({
        success: false,
        error: 'Token QR meja tidak valid. Silakan pindai ulang QR meja.'
      });
    }

    if (
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > 30
    ) {
      return res.status(400).json({
        success: false,
        error: 'Daftar pesanan tidak valid.'
      });
    }

    const normalizedItems: {
      menuId: string;
      quantity: number;
    }[] = [];

    const usedMenuIds = new Set<string>();

    for (const item of items) {
      if (
        !item ||
        typeof item.menuId !== 'string' ||
        item.menuId.trim().length < 1 ||
        item.menuId.length > 150 ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      ) {
        return res.status(400).json({
          success: false,
          error: 'Produk atau jumlah pesanan tidak valid.'
        });
      }

      const menuId = item.menuId.trim();

      if (usedMenuIds.has(menuId)) {
        return res.status(400).json({
          success: false,
          error: 'Produk yang sama tidak boleh dikirim dua kali.'
        });
      }

      usedMenuIds.add(menuId);

      normalizedItems.push({
        menuId,
        quantity: item.quantity
      });
    }

    const db = getFirestore(getAdminApp());

    const tableId = `Meja ${String(tableNumber).padStart(2, '0')}`;

    const tableRef = db
      .collection('restaurant_tables')
      .doc(tableId);

    const qrRef = db
      .collection('table_qr_tokens')
      .doc(tableId);

    const ordersRef = db.collection('orders');
    const orderRef = ordersRef.doc();

    const orderCode =
      `WB-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const itemRefs = normalizedItems.map(() =>
      db.collection('order_items').doc()
    );

    const result = await db.runTransaction(async (transaction) => {
      // Semua pembacaan dilakukan sebelum penulisan transaksi.
      const tableSnapshot = await transaction.get(tableRef);
      const qrSnapshot = await transaction.get(qrRef);

      const activeOrdersSnapshot = await transaction.get(
        ordersRef
          .where('table_number', '==', tableNumber)
          .where('payment_status', '==', 'belum_lunas')
      );

      const menuSnapshots = await Promise.all(
        normalizedItems.map(item =>
          transaction.get(
            db.collection('menu_items').doc(item.menuId)
          )
        )
      );

      if (!tableSnapshot.exists) {
        throw new Error('MEJA_TIDAK_DITEMUKAN');
      }

      const tableData = tableSnapshot.data();

      const nomorMejaFirebase =
        tableData?.Table_number ?? tableData?.table_number;

      if (
        tableData?.is_active !== true ||
        Number(nomorMejaFirebase) !== tableNumber
      ) {
        throw new Error('MEJA_TIDAK_AKTIF');
      }

      if (!qrSnapshot.exists) {
        throw new Error('QR_TIDAK_VALID');
      }

      const qrData = qrSnapshot.data();

      if (
        qrData?.is_active !== true ||
        Number(qrData?.table_number) !== tableNumber ||
        qrData?.token_version !== 1 ||
        !safeHashMatch(tableQrToken, qrData?.token_hash)
      ) {
        throw new Error('QR_TIDAK_VALID');
      }

      if (!activeOrdersSnapshot.empty) {
        throw new Error('MEJA_SUDAH_DIPESAN');
      }

      const orderItems = [];
      let totalAmount = 0;

      for (
        let index = 0;
        index < normalizedItems.length;
        index++
      ) {
        const requested = normalizedItems[index];
        const menuSnapshot = menuSnapshots[index];

        if (!menuSnapshot.exists) {
          throw new Error('PRODUK_TIDAK_DITEMUKAN');
        }

        const menu = menuSnapshot.data();

        if (menu?.is_available !== true) {
          throw new Error('PRODUK_TIDAK_TERSEDIA');
        }

        const menuName = menu?.Nama ?? menu?.name;
        const rawPrice = menu?.Price ?? menu?.price;
        const itemPrice = Number(rawPrice);

        if (
          typeof menuName !== 'string' ||
          menuName.trim().length === 0 ||
          rawPrice === null ||
          rawPrice === undefined ||
          !Number.isFinite(itemPrice) ||
          itemPrice < 0
        ) {
          throw new Error('DATA_PRODUK_TIDAK_VALID');
        }

        const subtotal = Math.round(
          itemPrice * requested.quantity
        );

        if (!Number.isSafeInteger(subtotal)) {
          throw new Error('HARGA_PRODUK_TIDAK_VALID');
        }

        totalAmount += subtotal;

        orderItems.push({
          menu_id: requested.menuId,
          item_name: menuName.trim(),
          item_price: itemPrice,
          quantity: requested.quantity,
          subtotal
        });
      }

      if (!Number.isSafeInteger(totalAmount)) {
        throw new Error('TOTAL_PESANAN_TIDAK_VALID');
      }

      transaction.set(orderRef, {
        order_code: orderCode,
        customer_name: customerName,
        table_number: tableNumber,
        status: 'menunggu',
        payment_status: 'belum_lunas',
        total_amount: totalAmount,
        created_at: FieldValue.serverTimestamp()
      });

      orderItems.forEach((item, index) => {
        transaction.set(itemRefs[index], {
          order_id: orderRef.id,
          ...item
        });
      });

      return {
        orderId: orderRef.id,
        orderCode,
        totalAmount,
        tableNumber,
        customerName,
        items: orderItems
      };
    });

    return res.status(201).json({
      success: true,
      message: 'Pesanan berhasil dibuat. Silakan lakukan pembayaran di kasir.',
      order: result
    });

  } catch (error) {
    const message =
      error instanceof Error ? error.message : '';

    const knownErrors: Record<string, string> = {
      MEJA_TIDAK_DITEMUKAN: 'Nomor meja belum tersedia.',
      MEJA_TIDAK_AKTIF: 'Meja sedang tidak aktif.',
      QR_TIDAK_VALID: 'QR meja tidak valid atau sudah dinonaktifkan. Silakan pindai ulang.',
      MEJA_SUDAH_DIPESAN: 'Meja ini masih memiliki pesanan yang belum lunas.',
      PRODUK_TIDAK_DITEMUKAN: 'Salah satu produk tidak ditemukan.',
      PRODUK_TIDAK_TERSEDIA: 'Salah satu produk sedang tidak tersedia.',
      DATA_PRODUK_TIDAK_VALID: 'Data produk tidak valid.',
      HARGA_PRODUK_TIDAK_VALID: 'Harga produk tidak valid.',
      TOTAL_PESANAN_TIDAK_VALID: 'Total pesanan tidak valid.'
    };

    if (knownErrors[message]) {
      const status =
        message === 'MEJA_SUDAH_DIPESAN'
          ? 409
          : message === 'QR_TIDAK_VALID'
            ? 403
            : 400;

      return res.status(status).json({
        success: false,
        error: knownErrors[message]
      });
    }

    // Jangan mencatat token QR atau isi lengkap permintaan ke log.
    console.error('Create order error:', message || 'Unknown error');

    return res.status(500).json({
      success: false,
      error: 'Pesanan gagal disimpan. Silakan coba kembali.'
    });
  }
}

