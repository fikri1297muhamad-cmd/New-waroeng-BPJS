import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin_accessHandler from '../api-handlers/admin-access.ts';
import archive_orderHandler from '../api-handlers/archive-order.ts';
import create_cashierHandler from '../api-handlers/create-cashier.ts';
import create_orderHandler from '../api-handlers/create-order.ts';
import delete_trashed_orderHandler from '../api-handlers/delete-trashed-order.ts';
import generate_table_qrHandler from '../api-handlers/generate-table-qr.ts';
import list_cashiersHandler from '../api-handlers/list-cashiers.ts';
import preview_table_migrationHandler from '../api-handlers/preview-table-migration.ts';
import record_paymentHandler from '../api-handlers/record-payment.ts';
import restore_orderHandler from '../api-handlers/restore-order.ts';
import seed_tablesHandler from '../api-handlers/seed-tables.ts';
import set_cashier_statusHandler from '../api-handlers/set-cashier-status.ts';
import trash_orderHandler from '../api-handlers/trash-order.ts';
import update_cashierHandler from '../api-handlers/update-cashier.ts';
import update_table_statusHandler from '../api-handlers/update-table-status.ts';
import verify_table_qrHandler from '../api-handlers/verify-table-qr.ts';

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  'admin-access': admin_accessHandler,
  'archive-order': archive_orderHandler,
  'create-cashier': create_cashierHandler,
  'create-order': create_orderHandler,
  'delete-trashed-order': delete_trashed_orderHandler,
  'generate-table-qr': generate_table_qrHandler,
  'list-cashiers': list_cashiersHandler,
  'preview-table-migration': preview_table_migrationHandler,
  'record-payment': record_paymentHandler,
  'restore-order': restore_orderHandler,
  'seed-tables': seed_tablesHandler,
  'set-cashier-status': set_cashier_statusHandler,
  'trash-order': trash_orderHandler,
  'update-cashier': update_cashierHandler,
  'update-table-status': update_table_statusHandler,
  'verify-table-qr': verify_table_qrHandler
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route;
  const selected = typeof route === 'string' ? handlers[route] : undefined;

  if (!selected) {
    return res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' });
  }

  return await selected(req, res);
}
