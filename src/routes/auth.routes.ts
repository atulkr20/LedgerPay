import { Router } from 'express';
import { signup, login } from '../controllers/auth.controllers';
import { validate, SignupSchema, LoginSchema } from '../dtos/wallet.dto';

export const authRoutes = Router();

authRoutes.post('/signup', validate(SignupSchema), signup);
authRoutes.post('/login', validate(LoginSchema), login);
