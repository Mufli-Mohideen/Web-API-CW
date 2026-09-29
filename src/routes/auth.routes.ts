import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { signUserToken } from '../auth/tokens';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { parse } from '../http/validation';
import { toUser } from '../representations';

export const authRouter = Router();

// Brute-force protection on the credential exchange.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts; try again later')),
});

const credentials = z.strictObject({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * POST /auth/tokens - an SLSEA user exchanges email + password for a short-lived JWT
 * access token carrying their role and jurisdiction. (Devices do not use this: they
 * authenticate every write with their installation's API key.)
 */
authRouter
  .route('/tokens')
  .post(loginLimiter, async (req, res) => {
    const { email, password } = parse(credentials, req.body, 'body');
    const user = await collections.users().findOne({ email: email.toLowerCase() });
    // Same response for unknown email and wrong password, so accounts cannot be enumerated.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw ApiError.unauthorized('Email or password is incorrect');
    }
    const { token, expiresIn } = signUserToken({
      sub: user._id.toHexString(),
      role: user.role,
      province_id: user.province_id,
      district_id: user.district_id,
    });
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ access_token: token, token_type: 'Bearer', expires_in: expiresIn, user: toUser(user) });
  })
  .all(methodNotAllowed('POST'));
