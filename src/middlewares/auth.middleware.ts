import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';


declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string;
            };
        }
    }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if(!authHeader || !authHeader.startsWith('Bearer')) {
        res.status(401).json({ error: "UNAUTHORIZED", message: "Missing or invalid token"});
        return;
    }

    const token = authHeader.split(' ')[1];

    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string, email: string };

        // if token is valid, add in user data request for controlers
        req.user = decoded;
        next();
    }
    catch(error) {
        res.status(401).json({ error: "UNAUTHORIZED", message: "Token expired or invalid"});
    }
};