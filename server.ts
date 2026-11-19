import express from 'express';
import adminAccessHandler from './api/admin-access.ts';
import updateTableStatusHandler from './api/update-table-status.ts';
import recordPaymentHandler from './api/record-payment.ts';
import previewTableMigrationHandler from './api/preview-table-migration.ts';
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
