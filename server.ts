import express from 'express';
import updateTableStatusHandler from './api/update-table-status.ts';
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

const port = Number(process.env.LOCAL_API_PORT || 3001);

app.listen(port, '127.0.0.1', () => {
  console.log(`Local API ready at http://127.0.0.1:${port}`);
});
