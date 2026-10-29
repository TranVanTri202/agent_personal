import { EncryptionService } from '../../src/common/security/encryption.service';
import { ConfigService } from '@nestjs/config';

describe('EncryptionService', () => {
  let encryptionService: EncryptionService;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
    } as unknown as ConfigService;

    encryptionService = new EncryptionService(configService);
  });

  it('should encrypt and decrypt string accurately using AES-256-GCM', () => {
    const originalText = 'SensitiveOAuthRefreshToken12345';
    const encrypted = encryptionService.encrypt(originalText);

    expect(encrypted).not.toBe(originalText);
    expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:cipher

    const decrypted = encryptionService.decrypt(encrypted);
    expect(decrypted).toBe(originalText);
  });

  it('should generate 6-digit random codes', () => {
    const code = encryptionService.generateRandomCode(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('should generate consistent action digest HMAC', () => {
    const payload = { to: 'customer@example.com', body: 'Hello' };
    const digest1 = encryptionService.computeActionDigest('send_email', payload);
    const digest2 = encryptionService.computeActionDigest('send_email', payload);
    const digestDifferent = encryptionService.computeActionDigest('send_email', { ...payload, body: 'Different' });

    expect(digest1).toBe(digest2);
    expect(digest1).not.toBe(digestDifferent);
  });
});
