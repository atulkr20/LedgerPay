import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { PrismaClient } from '@prisma/Client';

const prisma = new PrismaClient();

export const idempotency = async (req: Request, res: Response, next: NextFunction) => {
    if(req.method === 'GET') return next();
    
    // Every money moving request must have a uniques ticketNumber in the headers
    const ticketNumber = req.headers['idempotency-key'] as string;

    if(!ticketNumber) {
        return res.status(400).json({ error: "You forgot your idempotency-key header"})
    }

    try {
        // Fast cache Check (redis)
        const cachedResponse = await redis.get(`idempotency:${ticketNumber}`);

        if(cachedResponse) {
            // Race condition prevention
            if(cachedResponse === 'processing') {
                return res.status(409).json({ error: "Conflict: This request is already being processed"});

            } 
            console.log(`[idempotecy] Caught dulpicate for ticket: ${ticketNumber} in REDIS. Returning saved receipt`);
            return res.status(200).json(JSON.parse(cachedResponse));
        }

        // Deep deposit Check (postgres db)
        // if redis was crashed, then we will check in postgres
        const dbRecord = await prisma.idempotencyKey.findUnique({
            where:{ key: ticketNumber }
        });

        if(dbRecord) {
            console.log(`[idempotency] Caught duplicate for ticket: ${ticketNumber} in POSTGRES. Restoring to Redis.`);

            await redis.set(`idempotency:${ticketNumber}`, JSON.stringify(dbRecord.responseBody), 'EX', 86400);
            return res.status(dbRecord.responseStatus || 200).json(dbRecord.responseBody);
        }

        // In Flight Lock (Race condition protection)
        // We are telling Redis ki "Ye ticket process ho rha hia 10 sec tk kisi aur ko aane mat dena"
        await redis.set(`idempotency:${ticketNumber}`, 'processing', 'EX', 10);

        // Intercept Response

        const originalSendFunction = res.json.bind(res);

        res.json  =((body: any) => {
            if(res.statusCode >= 200 && res.statusCode < 300) {
                // Save teh final receipt in Redis for 24 hours
                redis.set(`idempotency:${ticketNumber}`, JSON.stringify(body), 'EX', 86400).catch(console.error);
            } else {
                console.log(`Request failed with ${ res.statusCode}.Removing processing lock.`);
                
            }
            // If failed remove the lock so that user can retry
                return originalSendFunction(body);
        }) as any;
        next();
    } catch (error) {
        next(error);
    }
};