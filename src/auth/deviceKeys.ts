import crypto from 'node:crypto';

const PREFIX = 'sk_dev_';

/** A new random device API key. Shown to the caller once; only its hash is stored. */
export function generateDeviceKey(): string {
  return PREFIX + crypto.randomBytes(24).toString('base64url');
}

/** Deterministic key for seeded installations, so demo devices/simulators can be re-derived. */
export function deriveDeviceKey(secret: string, meterId: string): string {
  return PREFIX + crypto.createHmac('sha256', secret).update(meterId).digest('base64url').slice(0, 32);
}

export function hashDeviceKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
