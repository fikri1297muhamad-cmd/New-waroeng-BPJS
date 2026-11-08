
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';

function getAdminApp() {
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
    const tableRef = db.collection('restaurant_tables').doc(tableId);

    const orderRef = db.collection('orders').doc();
    const orderCode =
      `WB-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const itemRefs = normalizedItems.map(() =>
      db.collection('order_items').doc()
    );

    const result = await db.runTransaction(async (transaction) => {
      console.log('PEMERIKSAAN MEJA:', {
  projectId: getAdminApp().options.projectId,
  tableId: tableId
});
      const tableSnapshot = await transaction.get(tableRef);

      if (!tableSnapshot.exists) {
        throw new Error('MEJA_TIDAK_DITEMUKAN');
      }

      const tableData = tableSnapshot.data();

      if (
        tableData?.is_active !== true ||
        Number(tableData?.table_number) !== tableNumber
      ) {
        throw new Error('MEJA_TIDAK_AKTIF');
      }

      const menuSnapshots = await Promise.all(
        normalizedItems.map(item =>
          transaction.get(
            db.collection('menu_items').doc(item.menuId)
          )
        )
      );

      const orderItems = [];
      let totalAmount = 0;

      for (let index = 0; index < normalizedItems.length; index++) {
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

const subtotal = Math.round(itemPrice * requested.quantity);

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
    console.error('Create order error:', error);

    const message =
      error instanceof Error ? error.message : '';

    const knownErrors: Record<string, string> = {
      MEJA_TIDAK_DITEMUKAN: 'Nomor meja belum tersedia.',
      MEJA_TIDAK_AKTIF: 'Meja sedang tidak aktif.',
      PRODUK_TIDAK_DITEMUKAN: 'Salah satu produk tidak ditemukan.',
      PRODUK_TIDAK_TERSEDIA: 'Salah satu produk sedang tidak tersedia.',
      DATA_PRODUK_TIDAK_VALID: 'Data produk tidak valid.',
      HARGA_PRODUK_TIDAK_VALID: 'Harga produk tidak valid.',
      TOTAL_PESANAN_TIDAK_VALID: 'Total pesanan tidak valid.'
    };

    if (knownErrors[message]) {
      return res.status(400).json({
        success: false,
        error: knownErrors[message]
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Pesanan gagal disimpan. Silakan coba kembali.'
    });
  }
}
