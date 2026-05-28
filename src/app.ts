import express, { Request, Response } from 'express'
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';

import { walletRoutes } from './routes/wallet.routes';
import { authRoutes } from './routes/auth.routes';

export const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.json({
    "service": "LedgerPay",
    "description": "Double-entry wallet system with ACID-compliant transactions",
    "version": "1.0.0",
    "status": "ok",
    "features": [
      "Double-entry bookkeeping",
      "Idempotent transaction processing",
      "Row-level locking for concurrency safety"
    ],
    "github": "github.com/atulkr20/ledgerpay",
    "live": "ledgerpay.itsatul.tech/api-docs"
  });
});

const swaggerPath = path.join(__dirname, '../swagger.yaml');

app.get('/api-docs.json', (_req: Request, res: Response) => {
  const swaggerDocument = YAML.load(swaggerPath);
  res.setHeader('Cache-Control', 'no-store');
  return res.json(swaggerDocument);
});

const swaggerUiOptions = {
  swaggerOptions: {
    url: '/api-docs.json',
  },
};

app.use(
  '/api-docs',
  swaggerUi.serveFiles(undefined, swaggerUiOptions),
  swaggerUi.setup(undefined, swaggerUiOptions),
);

app.use('/api/auth', authRoutes);
app.use('/api/wallets', walletRoutes);
