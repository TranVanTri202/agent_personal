import { SsrfValidator } from '../../src/common/security/ssrf.validator';

describe('SsrfValidator', () => {
  it('should allow public domains', async () => {
    await expect(SsrfValidator.assertSafeUrl('https://example.com/image.png')).resolves.not.toThrow();
  });

  it('should block localhost and 127.0.0.1 loopback', async () => {
    await expect(SsrfValidator.assertSafeUrl('http://127.0.0.1/secret')).rejects.toThrow('SSRF blocked');
    await expect(SsrfValidator.assertSafeUrl('http://localhost:3000')).rejects.toThrow('SSRF blocked');
  });

  it('should block AWS metadata IP 169.254.169.254', async () => {
    await expect(SsrfValidator.assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('SSRF blocked');
  });

  it('should block private network IP ranges (10.x, 192.168.x)', async () => {
    await expect(SsrfValidator.assertSafeUrl('http://10.0.0.1/admin')).rejects.toThrow('SSRF blocked');
    await expect(SsrfValidator.assertSafeUrl('http://192.168.1.1/router')).rejects.toThrow('SSRF blocked');
  });

  it('should block disallowed protocols like file:// or ftp://', async () => {
    await expect(SsrfValidator.assertSafeUrl('file:///etc/passwd')).rejects.toThrow('Disallowed URL protocol');
  });
});
