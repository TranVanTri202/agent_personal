import * as dns from 'dns';
import * as net from 'net';
import { URL } from 'url';

export class SsrfValidator {
  private static isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      // 10.0.0.0/8
      if (parts[0] === 10) return true;
      // 172.16.0.0/12
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 127.0.0.0/8 (loopback)
      if (parts[0] === 127) return true;
      // 169.254.0.0/16 (link-local, cloud metadata e.g. AWS 169.254.169.254)
      if (parts[0] === 169 && parts[1] === 254) return true;
      // 0.0.0.0
      if (parts[0] === 0) return true;
      return false;
    } else if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      // loopback
      if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
      // Unique local address fc00::/7
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
      // Link-local fe80::/10
      if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
      return false;
    }
    return true;
  }

  static async assertSafeUrl(urlString: string): Promise<void> {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Disallowed URL protocol: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname;
    // Check direct IP hostname
    if (net.isIP(hostname)) {
      if (this.isPrivateIp(hostname)) {
        throw new Error(`SSRF blocked: Private or loopback IP address ${hostname}`);
      }
      return;
    }

    // Resolve DNS
    const addresses = await dns.promises.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (this.isPrivateIp(addr.address)) {
        throw new Error(`SSRF blocked: Domain ${hostname} resolves to private IP ${addr.address}`);
      }
    }
  }
}
