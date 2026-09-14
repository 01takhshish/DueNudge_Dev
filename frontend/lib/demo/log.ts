import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * A visitor's demo mutations, as a compact log: [code, timestampMs, ...args]. Stored deflated + base64url
 * in a cookie so it travels with every request (route handlers AND server components, on any instance).
 */
export type Op = [code: string, t: number, ...args: unknown[]];

export const MAX_ENCODED = 3800; // stay under the 4 KB cookie limit

export function encodeLog(ops: Op[]): string {
  if (!ops.length) return '';
  return deflateRawSync(Buffer.from(JSON.stringify(ops), 'utf8')).toString('base64url');
}

export function decodeLog(value: string | undefined): Op[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(inflateRawSync(Buffer.from(value, 'base64url')).toString('utf8'));
    return Array.isArray(parsed) ? (parsed as Op[]) : [];
  } catch {
    return [];
  }
}
