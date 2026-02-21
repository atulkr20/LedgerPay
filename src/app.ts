import express from 'express'
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import path from 'path';

import { walletRoutes } from './routes/wallet.routes';

export const app = express();

app.use(cors());
app.use(express.json());

const swaggerPath = path.join(__dirname, '../swagger.yaml');

app.get('/swagger.yaml', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(swaggerPath);
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(undefined, {
  swaggerOptions: {
    url: '/swagger.yaml',
  },
}));


app.use('/api/wallets', walletRoutes);
