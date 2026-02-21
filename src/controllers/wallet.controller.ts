import { Request, Response } from 'express';
import { LedgerService } from '../services/ledger.service';

export class WalletController {
    // Creating wallet

    static async create(req: Request, res: Response) {

        try{
            const {userId} = req.body;
            const wallet = await LedgerService.createWallet(userId);

            res.status(201).json({ success: true, data: wallet });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    // handle balance checks
    static async balance(req: Request, res: Response ) {
        try{
            const accountId = req.params.accountId as string;
            if (!accountId) {
                return res.status(400).json({ error: "accountId is required" });
            }
            const balance = await LedgerService.getBalance(accountId);
            res.json({ success: true, balance})
        } catch (error: any) {
            res.status(400).json({ error: error.message});
        }
    }

    // Handling Deposits 
    static async addMoney(req: Request, res: Response) {
        try{
            const ticketNumber = req.headers['idempotency-key'] as string;
            const { accountId, amount } = req.body;

            const result = await LedgerService.addMoney(accountId, amount, ticketNumber);
            res.json({ success: true, transaction: result });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    // Handling the Transfers
    static async transfer(req: Request, res: Response) {
    try {
      const ticketNumber = req.headers['idempotency-key'] as string;
      const { fromAccountId, toAccountId, amount } = req.body;
      
      const result = await LedgerService.transfer(fromAccountId, toAccountId, amount, ticketNumber);
      res.json({ success: true, transaction: result });
    } catch (error: any) { 
      res.status(400).json({ error: error.message }); 
    }
  }

    // Handling Withdrawals
    static async withdraw(req: Request, res: Response) {
        try{
            const ticketNumber =req.headers['idempotency-key'] as string;
            const { accountId, amount } = req.body;

            const result = await LedgerService.withdraw(accountId, amount, ticketNumber);
            res.json({ success: true, transaction: result});
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    };

    // Handling Refunds
    static async refund(req: Request, res: Response) {
        try {
            const ticketNumber = req.headers['idempotency-key'] as string;
            const { originalTransactionId } = req.body;

            const result = await LedgerService.refund(originalTransactionId, ticketNumber);
            res.json({ success: true, transaction: result });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }
}