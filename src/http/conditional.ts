import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { ApiError } from '../errors/ApiError';

/** Strong ETag: a hash of the exact JSON representation. */
export function etagFor(body: unknown): string {
  const hash = crypto.createHash('sha1').update(JSON.stringify(body)).digest('base64url');
  return `"${hash}"`;
}

function listMatches(header: string, etag: string): boolean {
  if (header.trim() === '*') return true;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

interface SendOptions {
  status?: number;
  lastModified?: Date | null;
}

/**
 * Sends a JSON representation with validators (ETag, Last-Modified) and answers
 * conditional GETs: 304 Not Modified with an empty body when the client already holds
 * the current version. If-None-Match takes precedence over If-Modified-Since (RFC 9110).
 */
export function sendRepresentation(req: Request, res: Response, body: unknown, options: SendOptions = {}): void {
  const etag = etagFor(body);
  res.set('ETag', etag);
  res.set('Cache-Control', 'private, no-cache'); // cache, but revalidate every time
  res.vary('Authorization'); // representations depend on the caller's jurisdiction
  if (options.lastModified) res.set('Last-Modified', options.lastModified.toUTCString());

  if (req.method === 'GET' || req.method === 'HEAD') {
    const ifNoneMatch = req.get('If-None-Match');
    const ifModifiedSince = req.get('If-Modified-Since');
    let notModified = false;
    if (ifNoneMatch) {
      notModified = listMatches(ifNoneMatch, etag);
    } else if (ifModifiedSince && options.lastModified) {
      const since = Date.parse(ifModifiedSince);
      // HTTP dates have 1-second precision.
      notModified = !Number.isNaN(since) && Math.floor(options.lastModified.getTime() / 1000) * 1000 <= since;
    }
    if (notModified) {
      res.status(304).end();
      return;
    }
  }

  res.status(options.status ?? 200).json(body);
}

/** Optimistic concurrency for PUT/PATCH/DELETE: If-Match must match the current ETag, else 412. */
export function checkIfMatch(req: Request, currentBody: unknown): void {
  const ifMatch = req.get('If-Match');
  if (ifMatch && !listMatches(ifMatch, etagFor(currentBody))) {
    throw ApiError.preconditionFailed();
  }
}

/** Most recent of a set of dates, used as a collection's Last-Modified. */
export function latestDate(dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) if (date && (!latest || date > latest)) latest = date;
  return latest;
}
