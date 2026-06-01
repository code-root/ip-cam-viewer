import dgram from 'dgram';
import os from 'os';
import { randomUUID } from 'crypto';

export interface DiscoveredDevice {
  host: string;
  port: number;
  name?: string;
  manufacturer?: string;
  source: 'multicast' | 'unicast';
}

const WS_DISCOVERY_PROBE = (messageId: string) =>
  Buffer.from(
    '<Envelope xmlns="http://www.w3.org/2003/05/soap-envelope" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
      '<Header>' +
      `<wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:uuid:${messageId}</wsa:MessageID>` +
      '<wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04/discovery</wsa:To>' +
      '<wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>' +
      '</Header>' +
      '<Body>' +
      '<Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">' +
      '<Types>dn:NetworkVideoTransmitter</Types>' +
      '<Scopes />' +
      '</Probe>' +
      '</Body>' +
      '</Envelope>'
  );

function parseProbeResponse(xml: string, fallbackHost: string): DiscoveredDevice | null {
  const xaddrs = xml.match(/<[^>]*XAddrs[^>]*>([^<]+)</i)?.[1];
  const scopes = xml.match(/<[^>]*Scopes[^>]*>([^<]+)</i)?.[1] || '';
  if (!xaddrs) return null;

  const firstUrl = xaddrs.trim().split(/\s+/)[0];
  try {
    const u = new URL(firstUrl);
    const host = u.hostname || fallbackHost;
    const port = parseInt(u.port, 10) || 80;
    let name: string | undefined;
    const nameMatch = scopes.match(/\bname\/([^/\s]+)/i);
    if (nameMatch) name = decodeURIComponent(nameMatch[1]);
    const mfrMatch = scopes.match(/\bhardware\/([^/\s]+)/i);
    return {
      host,
      port,
      name,
      manufacturer: mfrMatch ? decodeURIComponent(mfrMatch[1]) : undefined,
      source: 'unicast',
    };
  } catch {
    return { host: fallbackHost, port: 80, source: 'unicast' };
  }
}

/** Derive /24 CIDR from local IPv4, e.g. 192.168.1.100 → 192.168.1.0/24 */
export function guessLocalSubnets(): string[] {
  const nets = new Set<string>();
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const addr of ifaces || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const parts = addr.address.split('.').map(Number);
      if (parts.length !== 4) continue;
      nets.add(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
    }
  }
  return [...nets];
}

/** Parse 192.168.1.0/24 or 192.168.1.1-254 or single IP */
export function parseSubnetSpec(spec: string): string[] {
  const trimmed = spec.trim();
  if (!trimmed) return [];

  if (trimmed.includes('/')) {
    const [base, bitsStr] = trimmed.split('/');
    const bits = parseInt(bitsStr, 10);
    if (bits !== 24) {
      throw new Error('Only /24 subnets are supported (e.g. 192.168.1.0/24)');
    }
    const parts = base.split('.').map(Number);
    if (parts.length !== 4) throw new Error('Invalid subnet');
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) {
      ips.push(`${parts[0]}.${parts[1]}.${parts[2]}.${i}`);
    }
    return ips;
  }

  const rangeMatch = trimmed.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
  if (rangeMatch) {
    const [, prefix, startStr, endStr] = rangeMatch;
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    const ips: string[] = [];
    for (let i = start; i <= end; i++) ips.push(`${prefix}.${i}`);
    return ips;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) return [trimmed];
  throw new Error('Invalid subnet format — use 192.168.1.0/24 or 192.168.1.1-254');
}

function probeHostUnicast(
  ip: string,
  timeoutMs: number
): Promise<DiscoveredDevice | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const messageId = randomUUID();
    const request = WS_DISCOVERY_PROBE(messageId);
    let settled = false;

    const finish = (result: DiscoveredDevice | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    socket.on('message', (msg) => {
      const xml = msg.toString();
      if (!xml.includes('probeMatches') && !xml.includes('ProbeMatch')) return;
      finish(parseProbeResponse(xml, ip));
    });

    socket.on('error', () => finish(null));

    const timer = setTimeout(() => finish(null), timeoutMs);

    socket.send(request, 0, request.length, 3702, ip, (err) => {
      if (err) finish(null);
    });
  });
}

export async function scanSubnetForOnvif(
  subnetSpec: string,
  options: { perHostMs?: number; concurrency?: number } = {}
): Promise<DiscoveredDevice[]> {
  const perHostMs = options.perHostMs ?? 450;
  const concurrency = options.concurrency ?? 48;
  const ips = parseSubnetSpec(subnetSpec);
  const found = new Map<string, DiscoveredDevice>();

  for (let i = 0; i < ips.length; i += concurrency) {
    const batch = ips.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((ip) => probeHostUnicast(ip, perHostMs)));
    for (const dev of results) {
      if (!dev) continue;
      const key = `${dev.host}:${dev.port}`;
      if (!found.has(key)) found.set(key, dev);
    }
  }

  return [...found.values()];
}

export function mergeDiscovered(
  lists: Array<Array<{ host: string; port: number; name?: string; manufacturer?: string; source?: string }>>
): DiscoveredDevice[] {
  const map = new Map<string, DiscoveredDevice>();
  for (const list of lists) {
    for (const d of list) {
      const key = `${d.host}:${d.port}`;
      if (!map.has(key)) {
        map.set(key, { ...d, source: (d.source as DiscoveredDevice['source']) || 'multicast' });
      } else {
        const existing = map.get(key)!;
        if (!existing.name && d.name) existing.name = d.name;
        if (!existing.manufacturer && d.manufacturer) existing.manufacturer = d.manufacturer;
      }
    }
  }
  return [...map.values()];
}
