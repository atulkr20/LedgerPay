import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// Validation Middleware

export const validate = (schema: z.ZodTypeAny) => {
    return (req: Request, res: Response, next: NextFunction) => {
        try{
            req.body = schema.parse(req.body);
            next();
        } catch (error: any) {
            // 400 if user sent invalid data
            const details = error?.errors ?? error?.issues ?? error?.message ?? 'Invalid request body';
            return res.status(400).json({ error: details });
        }

    };
};

// Strict rules for each route
export const CreateWalletSchema = z.object({
    userId: z.string().min(1, "User ID cannot be empty"),
});

export const AmountSchema = z.object({
    accountId: z.string().uuid("Must be a valid uuid"),
    // Money must be strictly positive. No zero or negative transfers
    amount: z.number().positive("Amount must be greater than 0"),
});

export const TransferSchema = z.object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: z.number().positive("Amount must be greater than 0"),
}).refine(data=> data.fromAccountId !== data.toAccountId, {
    // Preventing users from sending money to themselves
    message: "Sender and receiver cannot be the same account",
    path: ["toAccountId"]
});

export const RefundSchema = z.object({
    originalTransactionId: z.string().uuid("Must be a valid UUID"),
});

export const SignupSchema = z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    name: z.string().optional(),
});

export const LoginSchema = z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required"),
});
