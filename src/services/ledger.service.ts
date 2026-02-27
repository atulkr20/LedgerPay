import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';

export class LedgerService {

    // Creating Wallet
    static async createWallet(userId: string) {
        return prisma.wallet.create({
            data: {
                userId: userId,
                accounts: {
                    create: [ { type: 'AVAILABLE'}]
                }
            },
            include: { accounts: true }
        });
    }

    // Add Money (Deposit)
    static async addMoney(accountId: string, amount: number, ticketNumber: string) {
        const amountDec = new Prisma.Decimal(amount);

        // Prisma.$transaction ensures that if the server crashes halfway though,
        // everything cancels out and no fake money is created

        return prisma.$transaction(async (tx) => {
            // Creating  the record of the event
            const transactionRecord = await tx.transaction.create({
                data: {
                    referenceId: ticketNumber,
                    type: 'DEPOSIT',
                    status: 'SUCCESS',
                    amount: amountDec
                }
            });

            //The credit entry 
            await tx.ledgerEntry.create({
                data: {
                    transactionId: transactionRecord.id,
                    ledgerAccountId: accountId,
                    entryType: 'CREDIT',
                    amount: amountDec
                }
            });

            // Atomic idempotency Save

            await tx.idempotencyKey.create({
                data: {
                        key: ticketNumber,
                        responseStatus: 200,
                        responseBody: { success: true, transaction: transactionRecord }
                    
                }
            });

            return transactionRecord;
        });
    }

    // Transfer Money (Double entryaccounting)
    static async transfer(fromAccountId: string, toAccountId: string, amount: number, ticketNumber: string ) {
        const safeAmount = new Prisma.Decimal(amount);

        return prisma.$transaction(async (tx) => {
            // Preventing Deadlocks by sorting IDs alphabetically
            const accountIds = [fromAccountId, toAccountId].sort();

            await tx.$executeRaw `
            SELECT id FROM "LedgerAccount"
            WHERE id IN (${Prisma.join(accountIds)})
            FOR UPDATE
            `;

            // Checking the balance safely 
            const balanceCheck = await tx.ledgerEntry.aggregate({
                where: { ledgerAccountId: fromAccountId },
                _sum: { amount: true }
            });
            const currentBalance = balanceCheck._sum.amount || new Prisma.Decimal(0);

            // If broke, throw an error
            if (currentBalance.lessThan(safeAmount)){
                throw new Error("INSUFFICIENT FUNDS");
        }

        // Printing the receipt
        const transactionRecord = await tx.transaction.create({
            data: {
                referenceId: ticketNumber,
                type: 'TRANSFER',
                status: 'SUCCESS',
                amount: safeAmount
            }
        });
        // Move the money
        await tx.ledgerEntry.createMany({
            data: [
                //DEBIT: subtract the money from the sender
                {
                    transactionId: transactionRecord.id,
                    ledgerAccountId: fromAccountId,
                    entryType: 'DEBIT',
                    amount: safeAmount.negated(),
                },
                // CREDIT: Add the money to the Receiver
                {
                    transactionId: transactionRecord.id,
                    ledgerAccountId: toAccountId,
                    entryType: 'CREDIT',
                    amount: safeAmount
                }
            ]
        });
        // Atomic idempotency Save
        await tx.idempotencyKey.create({
            data: {
                key: ticketNumber,
                responseStatus: 200,
                responseBody: { success: true, transaction: transactionRecord}
            }
        });
        return transactionRecord;
        });
    }

    // Withdraw Money
    static async withdraw(accountId: string, amount: number, ticketNumber: string) {
        const safeAmount = new Prisma.Decimal(amount);

        return prisma.$transaction(async (tx) => {
            // Lock only the user's row
            await tx.$executeRaw`
            SELECT id FROM "LedgerAccount"
            WHERE id = ${accountId}
            FOR UPDATE
            `;

            // Check balance safely
            const balanceCheck = await tx.ledgerEntry.aggregate({
                where: { ledgerAccountId: accountId },
                _sum: { amount: true }
            });
            const currentBalance = balanceCheck._sum.amount || new Prisma.Decimal(0);

            if (currentBalance.lessThan(safeAmount)) {
                throw new Error("INSUFFICIENT FUNDS");
            }
            // create the receipt
            const transactionRecord = await tx.transaction.create({
                data: { referenceId: ticketNumber, type: 'Withdraw', status: 'SUCCESS', amount: safeAmount}

            });
            // take the money away (DEBIT)
            await tx.ledgerEntry.create({
                data: {
                    transactionId: transactionRecord.id,
                    ledgerAccountId: accountId,
                    entryType: 'DEBIT',
                    amount: safeAmount.negated()
                }
                
            });
            // Atomic idempotency save
            await tx.idempotencyKey.create({
                data: {
                    key: ticketNumber,
                    responseStatus: 200, 
                    responseBody: { success: true, transaction: transactionRecord}
                }
            });
            return transactionRecord;



        })
    }

    // Refund a transaction
    static async refund(originalTransactionId: string, refundTicketNumber: string) {
        return prisma.$transaction(async (tx) => {
            // find original transaction and its ledger entries

            const oldTx = await tx.transaction.findUnique ({
                where: { id: originalTransactionId },
                include: { entries: true }
            });
            // Running safety checks
            if (!oldTx) throw new Error("NOT_FOUND");
            if(oldTx.status === 'REVERSED') throw new Error("ALREADY REFUNDED");

            // MArking the old transaction " Reversed " so nobody can refund it twice
            await tx.transaction.update({
                where: { id: originalTransactionId },
                data: { status: 'Reversed'}
            });

            // Creating a Brand new Refund transaction record
            const newRefundTx = await tx.transaction.create({
                data: {
                    referenceId: refundTicketNumber,
                    type: 'REFUND',
                    status: 'SUCCESS',
                    amount: oldTx.amount
                }
            });

            // Create reverse ledger entries
            const reverseEntries = oldTx.entries.map((oldEntry) => {
                return {
                    transactionId: newRefundTx.id,
                    ledgerAccountId: oldEntry.ledgerAccountId,
                    entryType: oldEntry.entryType === 'DEBIT' ? 'CREDIT' : 'DEBIT',
                    amount: new Prisma.Decimal(oldEntry.amount).negated()
                }
            });
            // save the reversing entries to the db
            await tx.ledgerEntry.createMany({ data: reverseEntries });

            // Atomic idempotency Save
            await tx.idempotencyKey.create({
                data: {
                    key: refundTicketNumber,
                    responseStatus: 200,
                    responseBody: { success: true, transaction: newRefundTx }
                }
            });

            return newRefundTx;
        });
    }
}