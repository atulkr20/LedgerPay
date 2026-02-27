import { Request, Response } from 'express';
import { LedgerService } from '../services/ledger.service';

export class WalletController {
    public static handleError(error: any, res: Response) {
        const msg = error?.message || "An unknown error occured";
        console.error(`[WalletController Error]: ${msg}`);

        if (msg.includes("NOT_FOUND") || msg.toLowerCase().includes("not found")) {
            return res.status(404).json({ error: msg });
        }
        if (msg.includes("ALREADY_REFUNDED") || msg.toLowerCase().includes("already refunded")) {
            return res.status(409).json({ error: msg }); // 409 conflict
        }
        if (msg.includes("INSUFFICIENT_FUNDS")) {
            return res.status(422).json({ error: msg }); // 422 Unprocessable entity
        }
        if (msg.includes("UNAUTHORIZED")) {
            return res.status(403).json({ error: msg });
        }

        // If we don't recognize the error, it's a 500 server error
        return res.status(500).json({ error: "Internal Server Error" });
    }

    // Helper method to verify account ownership
    private static async checkOwnership(accountId: string, userId: string) {
        const account = await LedgerService.getAccountWithWallet(accountId);
        if (!account) {
            throw new Error("NOT_FOUND: Account not found");
        }
        if (account.wallet.userId !== userId) {
            throw new Error("UNAUTHORIZED: You don't own this account");
        }
    }

    // Handling Create Wallet
    static async create(req: Request, res: Response) {
        try {
            const wallet = await LedgerService.createWallet(req.body.userId);
            return res.status(201).json({ success: true, data: wallet });
        } catch (error: any) {
            return WalletController.handleError(error, res);
        }
    }

    // Handling Check Balance
    static async balance(req: Request<{ accountId: string }>, res: Response) {
        try {
            const accountId = req.params.accountId;
            if (!accountId) {
                return res.status(400).json({ error: "accountId is required" });
            }
            const balance = await LedgerService.getBalance(accountId);
            return res.json({ success: true, balance });
        } catch (error: any) {
            return WalletController.handleError(error, res);
        }
    }

    // Handling Transaction History
    static async getHistory(req: Request<{ accountId: string }>, res: Response) {
        try {
            const accountId = req.params.accountId;
            const userId = (req as any).user?.id;
            // fetch pagination values from query params
            const limit = parseInt(req.query.limit as string) || 10;
            const offset = parseInt(req.query.offset as string) || 0;

            if (!accountId) {
                return res.status(400).json({ error: 'accountId is required'});
            } 

            // Auth Check: Verify user owns this account
            if (userId) {
                await WalletController.checkOwnership(accountId, userId);
            }
            
            const history = await LedgerService.getTransactionHistory(accountId, limit, offset);
            return res.json({ success: true, ...history });

        } catch (error: any) {
            return WalletController.handleError(error, res);
        }
    }
    
    // Handling Add money
    static async addMoney(req: Request, res: Response) {
        try {
            const ticketNumber = req.headers['idempotency-key'] as string;
            const result = await  LedgerService.addMoney(req.body.accountId, req.body.amount, ticketNumber);
            res.json({ success: true, transaction: result});
        } catch (error: any) {
            return WalletController.handleError(error, res);
        }
    }
    // Handling Transfers
    static async transfer(req: Request, res: Response) {
        try {
            const ticketNumber = req.headers['idempotency-key'] as string;
            const { fromAccountId , toAccountId, amount } = req.body;
            const result = await LedgerService.transfer(fromAccountId, toAccountId, amount, ticketNumber);
            res.json({ success: true, transaction: result });
        } catch(error: any) {
            return WalletController.handleError(error, res);
        }
    }
    // Handling Withdraw
    static async withdraw(req: Request, res: Response) {
        try {
            const ticketNumber = req.headers['idempotency-key'] as string;
            const result = await LedgerService.withdraw(req.body.accountId, req.body.amount, ticketNumber);
            res.json({ success: true, transaction: result});
        } catch(error: any) {
            return WalletController.handleError(error, res);
        }
    }

    // Handling Refunds
    static async refund(req: Request, res: Response) {
        try {
            const ticketNumber = req.headers['idempotency-key'] as string;
            const result = await LedgerService.refund(req.body.originalTransactionId, ticketNumber);
            res.json({ success: true, transaction: result});
        } catch (error: any) {
            return WalletController.handleError(error, res);
        }
    }

}
