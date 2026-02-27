import { Router } from "express";
import { WalletController } from "../controllers/wallet.controller";
import { idempotency } from "../middlewares/idempotency";
import { requireAuth } from "../middlewares/auth.middleware";
import { validate, CreateWalletSchema, AmountSchema, TransferSchema, RefundSchema} from '../dtos/wallet.dto';
export const walletRoutes = Router();

// Note: Wallet is auto-created during signup. No manual creation needed.
walletRoutes.get('/:accountId/balance', requireAuth, WalletController.balance);
walletRoutes.get('/:accountId/history', requireAuth, WalletController.getHistory);
walletRoutes.post('/add-money', validate(AmountSchema),requireAuth, idempotency, WalletController.addMoney);
walletRoutes.post('/transfer', validate(TransferSchema), requireAuth, idempotency, WalletController.transfer);
walletRoutes.post('/withdraw', validate(AmountSchema),requireAuth, idempotency, WalletController.withdraw);
walletRoutes.post('/refund', validate(RefundSchema), requireAuth, idempotency, WalletController.refund); 