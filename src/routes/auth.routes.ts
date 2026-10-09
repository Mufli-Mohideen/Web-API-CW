import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { SCOPES, signDeviceToken, signUserToken } from '../auth/tokens';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { parse } from '../http/validation';
import { DEVICE_KEY_HEADER, installationForDeviceKey } from '../middleware/authenticate';
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

// Devices exchange their key far more often than people log in (one per device per run of
// the simulator), so the limit is higher; the keys themselves are 24 random bytes.
const deviceTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many token requests; try again later')),
});

/**
 * POST /auth/device-tokens - a metering device exchanges its installation's API key
 * (X-Device-Key) for a short-lived JWT with the installation:write scope. Only the token is
 * accepted when posting readings, so the long-lived key is sent once per token, not per reading.
 */
authRouter
  .route('/device-tokens')
  .post(deviceTokenLimiter, async (req, res) => {
    const key = req.get(DEVICE_KEY_HEADER);
    if (!key) throw ApiError.unauthorized(`A device API key is required in the ${DEVICE_KEY_HEADER} header`);
    const installation = await installationForDeviceKey(key);
    const installationId = installation._id.toHexString();
    const { token, expiresIn } = signDeviceToken(installationId, installation.meter_id);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: SCOPES.installationWrite,
      installation_id: installationId,
      meter_id: installation.meter_id,
    });
  })
  .all(methodNotAllowed('POST'));
