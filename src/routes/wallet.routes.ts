import { Router } from "express";
import { WalletController } from "../controllers/wallet.controller";
import { idempotency } from "../middlewares/idempotency";
import { validate, CreateWalletSchema, AmountSchema, TransferSchema, RefundSchema} from '../dtos/wallet.dto';
export const walletRoutes = Router();


// User -> Router -> idempotency -> Controller
walletRoutes.post('/create', validate(CreateWalletSchema), WalletController.create);
walletRoutes.get('/:accountId/balance', WalletController.balance);
walletRoutes.post('/add-money', validate(AmountSchema), idempotency, WalletController.addMoney);
walletRoutes.post('/transfer', validate(TransferSchema), idempotency, WalletController.transfer);
walletRoutes.post('/withdraw', validate(AmountSchema), idempotency, WalletController.withdraw);
walletRoutes.post('/refund', validate(RefundSchema), idempotency, WalletController.refund);