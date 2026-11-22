import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Phone numbers are encrypted at the application level (Master Plan section 5).
 *
 *  - encrypt/decrypt: AES-256-GCM with a random IV, for the value we may need to show again.
 *  - lookupHash: HMAC-SHA256 of the normalised number, so a row can be found by number without
 *    storing it. The key for each is derived from PHONE_ENC_KEY, so the two uses are independent.
 *
 * Losing PHONE_ENC_KEY makes every stored number unrecoverable and every lookup miss: back it up
 * with the other secrets, and never rotate it without a re-encryption migration.
 */
export function createPhoneCrypto(keyHex: string) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'PHONE_ENC_KEY must be 64 hex characters (32 bytes), e.g. openssl rand -hex 32',
    );
  }
  const master = Buffer.from(keyHex, 'hex');
  const derive = (label: string): Buffer =>
    Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), label, 32));
  const encKey = derive('uposhom/phone/encrypt');
  const macKey = derive('uposhom/phone/lookup');

  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
    },

    decrypt(payload: string): string {
      const [iv, tag, ct] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
      if (!iv || !tag || !ct) throw new Error('malformed phone_enc value');
      const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    },

    lookupHash(msisdn: string): string {
      return createHmac('sha256', macKey).update(msisdn).digest('hex');
    },
  };
}

export type PhoneCrypto = ReturnType<typeof createPhoneCrypto>;
