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
