import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as http2 from 'http2';

export const APNS_SENDER = Symbol('APNS_SENDER');
export const isApnsEndpoint = (e: string) => e.startsWith('apns:');
export type ApnsResult = 'ok' | 'gone' | 'error';
export interface ApnsSender {
  readonly configured: boolean;
  send(token: string, msg: { title: string; body: string; tab?: string }): Promise<ApnsResult>;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** ES256 provider token for APNs (valid up to 1 h; Apple asks not to refresh more than every 20 min). */
export function apnsJwt(keyId: string, teamId: string, privateKeyPem: string, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: nowSec }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(sig)}`;
}

/**
 * Apple Push Notification service (token-based auth, HTTP/2).
 * Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 contents), APNS_BUNDLE_ID (default APPLE_BUNDLE_ID or ae.sheen.straineat).
 * Tries production first, then the sandbox (Xcode debug builds) when Apple says the token is not for production.
 */
@Injectable()
export class ApnsService implements ApnsSender {
  private readonly log = new Logger(ApnsService.name);
  private readonly keyId?: string;
  private readonly teamId?: string;
  private readonly key?: string;
  private readonly topic: string;
  private jwt: { token: string; at: number } | null = null;
  readonly configured: boolean;

  constructor(config: ConfigService) {
    this.keyId = config.get<string>('APNS_KEY_ID') || undefined;
    this.teamId = config.get<string>('APNS_TEAM_ID') || undefined;
    const raw = config.get<string>('APNS_PRIVATE_KEY');
    this.key = raw ? raw.replace(/\\n/g, '\n') : undefined;
    this.topic = config.get<string>('APNS_BUNDLE_ID') || config.get<string>('APPLE_BUNDLE_ID') || 'ae.sheen.straineat';
    let ok = !!(this.keyId && this.teamId && this.key);
    if (ok) {
      try { apnsJwt(this.keyId!, this.teamId!, this.key!); } catch (e: any) { ok = false; this.log.error(`APNs disabled — bad APNS_PRIVATE_KEY: ${e?.message ?? e}`); }
    }
    this.configured = ok;
  }

  private token() {
    const now = Date.now();
    if (!this.jwt || now - this.jwt.at > 40 * 60000) this.jwt = { token: apnsJwt(this.keyId!, this.teamId!, this.key!), at: now };
    return this.jwt.token;
  }

  async send(token: string, msg: { title: string; body: string; tab?: string }): Promise<ApnsResult> {
    if (!this.configured) return 'error';
    // "tab" tells the app which screen to open when the alert is tapped
    const payload = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' }, ...(msg.tab ? { tab: msg.tab } : {}) });
    for (const host of ['https://api.push.apple.com', 'https://api.sandbox.push.apple.com']) {
      const r = await this.post(host, token, payload).catch((e) => ({ status: 0, reason: String(e?.message ?? e) }));
      if (r.status === 200) return 'ok';
      if (r.status === 410 || r.reason === 'Unregistered') return 'gone';
      if (r.reason === 'BadDeviceToken' && host.includes('api.push')) continue; // maybe a sandbox token
      if (r.reason === 'BadDeviceToken') return 'gone';
      this.log.warn(`APNs ${r.status} ${r.reason ?? ''}`);
      return 'error';
    }
    return 'error';
  }

  private post(host: string, token: string, payload: string): Promise<{ status: number; reason?: string }> {
    return new Promise((resolve, reject) => {
      const client = http2.connect(host);
      client.on('error', reject);
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${this.token()}`,
        'apns-topic': this.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      let status = 0;
      let data = '';
      req.setTimeout(10000, () => { req.close(); client.close(); reject(new Error('timeout')); });
      req.on('response', (h) => { status = Number(h[':status']); });
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        client.close();
        let reason: string | undefined;
        try { reason = data ? JSON.parse(data).reason : undefined; } catch {}
        resolve({ status, reason });
      });
      req.on('error', (e) => { client.close(); reject(e); });
      req.end(payload);
    });
  }
}
