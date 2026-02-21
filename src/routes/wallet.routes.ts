import { Router } from "express";
import { WalletController } from "../controllers/wallet.controller";
import { idempotency } from "../middlewares/idempotency";

export const walletRoutes = Router();


walletRoutes.post('/create', WalletController.create);
walletRoutes.get('/:accountId/balance', WalletController.balance);

walletRoutes.post('/add-money', idempotency, WalletController.addMoney);
walletRoutes.post('/transfer', idempotency, WalletController.transfer);
walletRoutes.post('/withdraw', idempotency, WalletController.withdraw);
walletRoutes.post('/refund', idempotency, WalletController.refund);

// User -> Router -> idempotency -> Controller