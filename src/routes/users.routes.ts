import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';
import { sendRepresentation } from '../http/conditional';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { toUser } from '../representations';

export const usersRouter = Router();

/** GET /users/me - the authenticated user's profile, role and jurisdiction. */
usersRouter
  .route('/me')
  .get(async (req, res) => {
    const user = await collections.users().findOne({ _id: new ObjectId(req.user!.sub) });
    if (!user) throw ApiError.notFound('User');
    sendRepresentation(req, res, toUser(user), { lastModified: user.updated_at });
  })
  .all(methodNotAllowed('GET'));
