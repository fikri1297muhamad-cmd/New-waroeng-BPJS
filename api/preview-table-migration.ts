import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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

    const decoded = await auth.verifyIdToken(token, true);
    const userId = decoded.uid;

    const profile = await db
      .collection('staff_profiles')
      .doc(userId)
      .get();

    const role = String(profile.data()?.role ?? '')
      .trim()
      .toLowerCase();

    if (!profile.exists || !['admin', 'admin 01'].includes(role)) {
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

    const activeStatuses = ['menunggu', 'diproses', 'siap'];

    const [tableSnapshots, activeOrdersSnapshot] = await Promise.all([
      Promise.all(
        Array.from({ length: 50 }, (_, index) => {
          const tableId = `Meja ${String(index + 1).padStart(2, '0')}`;
          return db.collection('restaurant_tables').doc(tableId).get();
        })
      ),
      db.collection('orders')
        .where('status', 'in', activeStatuses)
        .get()
    ]);

    const activeOrdersByTable = new Map<number, Array<Record<string, unknown>>>();

    activeOrdersSnapshot.forEach(orderDoc => {
      const data = orderDoc.data();
      const tableNumber = Number(data.table_number);

      if (
        Number.isInteger(tableNumber) &&
        tableNumber >= 1 &&
        tableNumber <= 50
      ) {
        const list = activeOrdersByTable.get(tableNumber) || [];

        list.push({
          order_id: orderDoc.id,
          order_code: data.order_code ?? null,
          status: data.status ?? null,
          payment_status: data.payment_status ?? null,
          table_session_id:
            typeof data.table_session_id === 'string'
              ? data.table_session_id.trim()
              : ''
        });

        activeOrdersByTable.set(tableNumber, list);
      }
    });

    const tables = tableSnapshots.map((snapshot, index) => {
      const tableNumber = index + 1;
      const tableId = `Meja ${String(tableNumber).padStart(2, '0')}`;
      const data = snapshot.data() || {};
      const activeOrders = activeOrdersByTable.get(tableNumber) || [];

      const currentStatus =
        typeof data.table_status === 'string'
          ? data.table_status.trim()
          : '';

      const tableSessionId =
        typeof data.table_session_id === 'string'
          ? data.table_session_id.trim()
          : '';

      const orderSessionIds = activeOrders
        .map(order => String(order.table_session_id || '').trim())
        .filter(Boolean);

      const allSessionIds = [
        ...new Set([tableSessionId, ...orderSessionIds].filter(Boolean))
      ];

      const sessionConflict = allSessionIds.length > 1;

      const recommendedStatus = currentStatus ||
        (activeOrders.length > 0 ? 'terisi' : 'perlu_dibersihkan');

      const statusMismatch =
        activeOrders.length > 0 &&
        recommendedStatus !== 'terisi';

      return {
        table_number: tableNumber,
        table_name: tableId,
        document_exists: snapshot.exists,
        is_active: data.is_active ?? null,
        current_status: currentStatus || null,
        active_order_count: activeOrders.length,
        active_orders: activeOrders,
        current_table_session_id: tableSessionId || null,
        order_session_ids: [...new Set(orderSessionIds)],
        session_conflict: sessionConflict,
        status_mismatch: statusMismatch,
        recommended_status: recommendedStatus,
        needs_initialization: !currentStatus
      };
    });

    const summary = {
      total_tables: 50,
      existing_documents: tables.filter(table => table.document_exists).length,
      missing_documents: tables.filter(table => !table.document_exists).length,
      missing_status: tables.filter(table => table.needs_initialization).length,
      occupied_recommendations: tables.filter(
        table => table.recommended_status === 'terisi'
      ).length,
      cleaning_recommendations: tables.filter(
        table => table.recommended_status === 'perlu_dibersihkan'
      ).length,
      empty_current_status: tables.filter(
        table => table.current_status === 'kosong'
      ).length,
      active_orders_total: activeOrdersSnapshot.size,
      session_conflicts: tables.filter(table => table.session_conflict).length,
      status_mismatches: tables.filter(table => table.status_mismatch).length,
      inactive_tables: tables.filter(table => table.is_active !== true).length
    };

    return res.status(200).json({
      success: true,
      mode: 'READ_ONLY_PREVIEW',
      message: 'Pratinjau selesai. Tidak ada data Firestore yang diubah.',
      summary,
      tables
    });

  } catch (error) {
    console.error('Preview table migration error:', error);

    return res.status(500).json({
      success: false,
      error: 'Gagal membaca pratinjau data meja.'
    });
  }
}
