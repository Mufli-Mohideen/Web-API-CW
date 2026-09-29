/**
 * Prints the API key of a seeded device (derived from DEVICE_KEY_SECRET and its meter id).
 * Usage: npm run device-key -- SLM-000001
 */
import 'dotenv/config';
import { deriveDeviceKey } from '../src/auth/deviceKeys';

const meterId = process.argv[2];
if (!meterId) {
  console.error('Usage: npm run device-key -- <meter_id>');
  process.exit(1);
}
console.log(deriveDeviceKey(process.env.DEVICE_KEY_SECRET ?? 'slsea-demo-device-secret', meterId.toUpperCase()));
