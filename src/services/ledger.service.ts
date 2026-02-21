import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';

export class LedgerService {

    // Creating wallet
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
    // Get Balance
    static async getBalance(accountId: string) {
        const result = await prisma.ledgerEntry.aggregate({
            where: { ledgerAccountId: accountId },
            _sum: { amount: true }
        });

        return result._sum.amount || new Prisma.Decimal(0);
    }

    // Add Money (Deposit)

    static async addMoney(accountId: string, amount: number, refId: string) {
    const amountDec = new Prisma.Decimal(amount);


    // Prisma.$transactions ensures that if the server crashes halfway through 
    // everything cancels out and no fake monry is created
    return prisma.$transaction(async (tx) => {
        // Creating the record of the event
        const transaction = await tx.transaction.create({
            data: {
                referenceId: refId,
                type: 'DEPOSIT',
                status: 'SUCCESS',
                amount: amountDec
            }
        });

        // The credit entry
        await tx.ledgerEntry.create({
            data: {
                transactionId: transaction.id,
                ledgerAccountId: accountId,
                entryType: 'CREDIT',
                amount: amountDec
            }
        });

        return transaction;

    });
    }
    
    // Transfer Money (Double entry accounting)

    static async transfer(fromAccountId: string, toAccountId: string, amount: number, ticketNumber: string) {
        // converting the number to safe decimal 
        const safeAmount = new Prisma.Decimal(amount);

        // Opening the bank vault
        // In $transactions everything either suceeds 100% or fails 100%
        return prisma.$transaction(async (tx) => {

            // Preventing the Double-click 
            // Here we sort the Ids alphabetically first so that it forces the db toi always 
            // lock account in same exact order.
            // This prevents the DeadLocks where two transfers freeze each other.

            const accountsToLock = [fromAccountId, toAccountId].sort();

            await tx.$executeRawUnsafe(
                `SELECT id FROM "LedgerAccount" WHERE id IN ($1, $2) FOR UPDATE`,
                ...accountsToLock
                // FOR UPDATE Locks these two rows so that nobody else can read or change them until I'm done.
            );

            // Checking the balance 
            // We ask db to add up all previous transactions for sender
            const balanceCheck = await tx.ledgerEntry.aggregate({
                where: { ledgerAccountId: fromAccountId },
                _sum: { amount: true }
            });
            const curentBalance = balanceCheck._sum.amount || new Prisma.Decimal(0);

            // If Broke, Throw an Error

            if (curentBalance.lessThan(safeAmount)) {
                throw new Error ( "You do not have enough money for this transfer");
            }

            // Printing the RECEIPT
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
                    // DEBIT: substract the money from the sender
                    {
                        transactionId: transactionRecord.id,
                        ledgerAccountId: fromAccountId,
                        entryType: 'DEBIT',
                        amount: safeAmount.negated()
                    },
                    //Credit: Add the money to the Receiver
                    {
                        transactionId: transactionRecord.id,
                        ledgerAccountId: fromAccountId,
                        entryType: 'CREDIT',
                        amount: safeAmount
                    }
                ]
            });
            return transactionRecord;


        });
    }

    // Withdraw Money 

    static async withdraw(accountId: string, amount: number, ticketNumber: string) {
        const safeAmount = new Prisma.Decimal(amount);

        return prisma.$transaction(async (tx) => {
            // Lock only the user's row
            await tx.$executeRawUnsafe(
                `SELECT id FROM "LedgerAccount" WHERE id = $1 FOR UPDATE`,
                accountId
            );

            //Check balance safely

            const balanceCheck = await tx.ledgerEntry.aggregate({
                where: { ledgerAccountId: accountId },
                _sum: { amount: true }
            });
            const currentBalance = balanceCheck._sum.amount || new Prisma.Decimal(0);
            if (currentBalance.lessThan(safeAmount)) {
                throw new Error("You do not have enough money to withdraw this amount.");

            }

            // Create the receipt
            const transactionRecord = await tx.transaction.create({
                data: { referenceId: ticketNumber, type: 'WITHDRAW', status: 'SUCCESS', amount: safeAmount } 
            });

            // Take the money away (DEBIT)
            await tx.ledgerEntry.create({
                data: {
                    transactionId: transactionRecord.id,
                    ledgerAccountId: accountId,
                    entryType: 'DEBIT',
                    amount: safeAmount.negated()
                }
            });
            return transactionRecord;
        });
    }

    // Refund a Transaction

    static async refund(originalTransactionId: string, refundTicketNumber: string) {
        return prisma.$transaction(async (tx) => {

            // Fin d original transaction and its ledger entries
            const oldTx = await tx.transaction.findUnique({
                where: { id: originalTransactionId },
                include: { entries: true } 
            });

            // Running safety checks
            if (!oldTx) throw new Error("Transaction not found");
            if(oldTx.status === 'REVERSED') throw new Error("This was already refunded");

            // Marking the old transaction "Reversed" so nobody can refund it twice
            await tx.transaction.update({
                where: { id: originalTransactionId },
                data: { status: 'REVERSED'}
            });

            // Creating a brand new "Refund transaction record
            const newRefundTx = await tx.transaction.create({
                data: {
                    referenceId: refundTicketNumber,
                    type: 'REFUND',
                    status: 'SUCCESS',
                    amount: oldTx.amount
                }
            });

            // Create a reverse ledger entries
            // if the entry has "DEBIT", we give it back "CREDIT".

            const reverseEntries = oldTx.entries.map((oldEntry) => {
                return {
                    transactionId: newRefundTx.id,
                    ledgerAccountId: oldEntry.ledgerAccountId,
                    // Flip DEBIT to CREDIt, and CREDIT to DEBIT
                    entryType: oldEntry.entryType === 'DEBIT' ? 'CREDIT' : 'DEBIT',
                    //Turn positive numbers negative, and negative numbers positive
                    amount: new Prisma.Decimal(oldEntry.amount).negated()
                }
            });

            // save the reversing entries to the db 
            await tx.ledgerEntry.createMany({ data: reverseEntries });

            return newRefundTx;

        });
    }

    


}