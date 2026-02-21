import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';

export const idempotency = async (req: Request, res: Response, next: NextFunction) => {
    // Every money moving request must have a unique ticket number in the headers
    const ticketNumber = req.headers['idempotency-key'] as string;

    if(!ticketNumber) {
        return res.status(400).json({ error: "You forgot your idempotency-key header"});

    }
    try{
        // Asking redis about the ticket processed or not
        const savedResponse = await redis.get(`idempotency:${ticketNumber}`);

        // If yes, hand them the old receipt
        if(savedResponse) {
            console.log("Caught duplicate click for ticket: ${ticketNumber}. Returning saved receipt");
            return res.status(200).json(JSON.parse(savedResponse));
        }

        // if No, we will create a new request, so that when the db finishes successfully,
        // we save a copy to redis before sending it back to the user.
        const originalSendFunction = res.json.bind(res);

        res.json = (body: any) => {
            // save the final receipt in redis for 24 hours 
            redis.set(`idempotency:${ticketNumber}`, JSON.stringify(body), 'EX', 86400).catch(console.error);

            return originalSendFunction(body);
        };

        next();

    } catch (error) {
        next(error);
    }
};