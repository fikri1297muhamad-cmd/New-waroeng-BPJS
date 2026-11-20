import express from 'express';
import adminAccessHandler from './api-handlers/admin-access.ts';
import createCashierHandler from './api-handlers/create-cashier.ts';
import listCashiersHandler from './api-handlers/list-cashiers.ts';
import archiveOrderHandler from './api-handlers/archive-order.ts';
import trashOrderHandler from './api-handlers/trash-order.ts';
import restoreOrderHandler from './api-handlers/restore-order.ts';
import deleteTrashedOrderHandler from './api-handlers/delete-trashed-order.ts';
import updateCashierHandler from './api-handlers/update-cashier.ts';
import setCashierStatusHandler from './api-handlers/set-cashier-status.ts';
import updateTableStatusHandler from './api-handlers/update-table-status.ts';
import recordPaymentHandler from './api-handlers/record-payment.ts';
import previewTableMigrationHandler from './api-handlers/preview-table-migration.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Request, Response } from 'express';

const app = express();

app.use(express.json({ limit: '32kb' }));

app.post('/api/update-table-status', (req: Request, res: Response) => {
  void updateTableStatusHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/update-table-status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/record-payment', (req: Request, res: Response) => {
  void recordPaymentHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/record-payment', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/preview-table-migration', (req: Request, res: Response) => {
  void previewTableMigrationHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/preview-table-migration', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});



app.post('/api/archive-order', (req: Request, res: Response) => {
  void archiveOrderHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});
app.all('/api/archive-order', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/delete-trashed-order', (req: Request, res: Response) => {
  void deleteTrashedOrderHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});
app.all('/api/delete-trashed-order', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/restore-order', (req: Request, res: Response) => {
  void restoreOrderHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});
app.all('/api/restore-order', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/trash-order', (req: Request, res: Response) => {
  void trashOrderHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});
app.all('/api/trash-order', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/list-cashiers', (req: Request, res: Response) => {
  void listCashiersHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/list-cashiers', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/update-cashier', (req: Request, res: Response) => {
  void updateCashierHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/update-cashier', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/set-cashier-status', (req: Request, res: Response) => {
  void setCashierStatusHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/set-cashier-status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/create-cashier', (req: Request, res: Response) => {
  void createCashierHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/create-cashier', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({
    success: false,
    error: 'Metode tidak diizinkan.'
  });
});

app.post('/api/admin-access', (req: Request, res: Response) => {
  void adminAccessHandler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse
  );
});

app.all('/api/admin-access', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(405).json({ error: 'Metode tidak diizinkan.' });
});

const port = Number(process.env.LOCAL_API_PORT || 3001);

app.listen(port, '127.0.0.1', () => {
  console.log(`Local API ready at http://127.0.0.1:${port}`);
});
