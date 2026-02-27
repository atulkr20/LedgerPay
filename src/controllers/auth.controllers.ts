import { Request, Response } from 'express';
import { prisma } from '../config/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const signup = async (req: Request, res: Response) => {
    try {
        const { email, password, name } = req.body;
        const existingUser = await prisma.user.findUnique({ where: { email }});
        if(existingUser ) return res.status(400).json({ error: "User already exists"});

        const passwordHash = await bcrypt.hash(password, 10);

        // Create a default wallet just after creating a user

        const user = await prisma.user.create({
            data: {
                email,
                name,
                passwordHash,
                wallet: {
                    create: {
                        accounts: {
                            create: [{ type: 'AVAILABLE' }]
                        }
                    }
                }
            }
        });
        res.status(201).json({ message: "User created", userId: user.id});
    } catch (error) {
        res.status(500).json({ error: "Internal Server error"});
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({ 
            where: { email },
            include: { 
                wallet: {
                    include: { accounts: { select: { id: true, type: true }, take: 1 } }
                }
            }
        });
        
        if(!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: "Invalid credentials"});
        } 

        // Generate jwt valid for a day
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET as string,
            { expiresIn: '1d' }
        );
        
        // Return user info with account details
        res.status(200).json({ 
            token, 
            userId: user.id,
            accountId: user.wallet?.accounts[0]?.id,
            accountType: user.wallet?.accounts[0]?.type || 'AVAILABLE'
        });
    } catch (error) {
        res.status(500).json({ error: "Internal server error"})
    }
};