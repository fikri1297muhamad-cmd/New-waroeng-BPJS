
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

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
        error: 'Silakan login sebagai Admin.'
      });
    }

    const decoded = await auth.verifyIdToken(token, true);
    const userId = decoded.uid;

    const profile = await db
      .collection('staff_profiles')
      .doc(userId)
      .get();

    const role = String(profile.data()?.role ?? '').trim().toLowerCase();
    if (!profile.exists || !['admin', 'admin 01'].includes(role)) {
      return res.status(403).json({
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
        error: 'Sesi Admin tidak aktif atau sudah kedaluwarsa.'
      });
    }

    const collection = db.collection('restaurant_tables');

    const activeOrdersSnapshot = await db
      .collection('orders')
      .where('status', 'in', ['menunggu', 'diproses', 'siap'])
      .get();

    const activeOrdersByTable = new Map<number, QueryDocumentSnapshot[]>();

    activeOrdersSnapshot.forEach(orderDoc => {
      const tableNumber = Number(orderDoc.data()?.table_number);
      if (Number.isInteger(tableNumber) && tableNumber >= 1 && tableNumber <= 50) {
        const list = activeOrdersByTable.get(tableNumber) || [];
        list.push(orderDoc);
        activeOrdersByTable.set(tableNumber, list);
      }
    });

    const references = Array.from({ length: 50 }, (_, index) => {
      const number = index + 1;
      const id = `Meja ${String(number).padStart(2, '0')}`;
      return { id, number, ref: collection.doc(id) };
    });

    let created = 0;
    let alreadyExists = 0;
    let initialized = 0;
    let sessionsPrepared = 0;
    let ordersLinked = 0;
    let conflicts = 0;
    let statusMismatches = 0;

    for (const item of references) {
      const candidateOrders = activeOrdersByTable.get(item.number) || [];

      if (candidateOrders.length > 400) {
        conflicts++;
        console.error(`Migrasi meja ${item.number} dilewati: pesanan aktif melebihi batas aman.`);
        continue;
      }

      const result = await db.runTransaction(async transaction => {
        const emptyResult = {
          conflict: false,
          statusMismatch: false,
          created: false,
          initialized: false,
          sessionPrepared: false,
          linkedOrders: 0
        };

        const tableSnapshot = await transaction.get(item.ref);
        const orderSnapshots = await Promise.all(
          candidateOrders.map(orderDoc => transaction.get(orderDoc.ref))
        );

        const currentActiveOrders = orderSnapshots.filter(orderSnapshot => {
          if (!orderSnapshot.exists) return false;
          const status = String(orderSnapshot.data()?.status ?? '').trim().toLowerCase();
          return ['menunggu', 'diproses', 'siap'].includes(status);
        });

        const tableData = tableSnapshot.data() || {};
        const existingStatus = String(tableData.table_status ?? '').trim();
        const effectiveStatus = existingStatus ||
          (currentActiveOrders.length > 0 ? 'terisi' : 'perlu_dibersihkan');

        if (currentActiveOrders.length > 0 && effectiveStatus !== 'terisi') {
          return { ...emptyResult, statusMismatch: true };
        }

        const existingTableSessionId =
          typeof tableData.table_session_id === 'string'
            ? tableData.table_session_id.trim()
            : '';

        let tableSessionId = existingTableSessionId;

        const orderSessionIds = currentActiveOrders
          .map(orderSnapshot => {
            const value = orderSnapshot.data()?.table_session_id;
            return typeof value === 'string' ? value.trim() : '';
          })
          .filter(Boolean);

        const allSessionIds = [...new Set(
          [tableSessionId, ...orderSessionIds].filter(Boolean)
        )];

        if (allSessionIds.length > 1) {
          return { ...emptyResult, conflict: true };
        }

        if (currentActiveOrders.length > 0 && !tableSessionId) {
          tableSessionId = allSessionIds[0] || collection.doc().id;
        }

        const tableUpdate = {
          ...(!tableSnapshot.exists
            ? { table_name: item.id, table_number: item.number, is_active: true }
            : {}),
          ...(!existingStatus
            ? {
                table_status: effectiveStatus,
                table_status_updated_at: FieldValue.serverTimestamp(),
                table_status_updated_by: userId
              }
            : {}),
          ...(tableSessionId && tableSessionId !== existingTableSessionId
            ? { table_session_id: tableSessionId }
            : {})
        };

        if (Object.keys(tableUpdate).length > 0) {
          transaction.set(item.ref, tableUpdate, { merge: true });
        }

        let linkedInTransaction = 0;

        if (tableSessionId) {
          currentActiveOrders.forEach(orderSnapshot => {
            const value = orderSnapshot.data()?.table_session_id;
            const existingOrderSession = typeof value === 'string' ? value.trim() : '';

            if (!existingOrderSession) {
              transaction.update(orderSnapshot.ref, {
                table_session_id: tableSessionId
              });
              linkedInTransaction++;
            }
          });
        }

        return {
          ...emptyResult,
          created: !tableSnapshot.exists,
          initialized: !existingStatus,
          sessionPrepared: currentActiveOrders.length > 0 && Boolean(tableSessionId),
          linkedOrders: linkedInTransaction
        };
      });

      if (result.conflict) {
        conflicts++;
        console.error(`Migrasi meja ${item.number} dilewati: ID sesi bertentangan.`);
        continue;
      }

      if (result.statusMismatch) {
        statusMismatches++;
        console.error(`Migrasi meja ${item.number} dilewati: ada pesanan aktif tetapi status meja bukan TERISI.`);
        continue;
      }

      if (result.created) created++;
      else alreadyExists++;

      if (result.initialized) initialized++;
      if (result.sessionPrepared) sessionsPrepared++;
      ordersLinked += result.linkedOrders;
    }

    return res.status(200).json({
      success: true,
      message: 'Pemeriksaan dan migrasi meja selesai.',
      created,
      alreadyExists,
      initialized,
      sessionsPrepared,
      ordersLinked,
      conflicts,
      statusMismatches,
      totalTables: 50
    });

  } catch (error) {
    console.error('Seed tables error:', error);

    return res.status(500).json({
      error: 'Gagal menyiapkan meja.'
    });
  }
}
