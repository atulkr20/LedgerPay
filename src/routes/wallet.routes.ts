import { Router } from "express";
import { WalletController } from "../controllers/wallet.controller";
import { idempotency } from "../middlewares/idempotency";
import { requireAuth } from "../middlewares/auth.middleware";
import { validate, CreateWalletSchema, AmountSchema, TransferSchema, RefundSchema} from '../dtos/wallet.dto';
export const walletRoutes = Router();

// User -> Router -> idempotency -> Controller
walletRoutes.post('/create', requireAuth, validate(CreateWalletSchema), WalletController.create);
walletRoutes.get('/:accountId/balance', requireAuth, WalletController.balance);
walletRoutes.post('/add-money', validate(AmountSchema),requireAuth, idempotency, WalletController.addMoney);
walletRoutes.post('/transfer', validate(TransferSchema), requireAuth, idempotency, WalletController.transfer);
walletRoutes.post('/withdraw', validate(AmountSchema),requireAuth, idempotency, WalletController.withdraw);
walletRoutes.post('/refund', validate(RefundSchema), requireAuth, idempotency, WalletController.refund); 