/**
 * HTTP Client Utility - Simplified from antigravity-panel-main
 * Supports automatic HTTPS → HTTP fallback for local Language Server communication
 */

import * as https from 'https';
import * as http from 'http';

export type Protocol = 'https' | 'http';

export interface HttpResponse<T = unknown> {
    statusCode: number;
    data: T;
    protocol: Protocol;
}

/**
 * Protocol cache: remembers which protocol works for each host:port
 * Limited size to prevent memory leaks
 */
const MAX_CACHE_SIZE = 100;
const protocolCache = new Map<string, Protocol>();

function getCachedProtocol(hostname: string, port: number): Protocol {
    return protocolCache.get(`${hostname}:${port}`) || 'https';
}

function setCachedProtocol(hostname: string, port: number, protocol: Protocol): void {
    const key = `${hostname}:${port}`;

    // LRU-style eviction: Remove oldest entry if cache is full
    if (protocolCache.size >= MAX_CACHE_SIZE) {
        const firstKey = protocolCache.keys().next().value;
        if (firstKey) {
            protocolCache.delete(firstKey);
        }
    }

    protocolCache.set(key, protocol);
}

/**
 * Make HTTP/HTTPS request with automatic fallback
 */
export async function makeRequest<T>(
    hostname: string,
    port: number,
    path: string,
    headers: Record<string, string>,
    body?: string,
    timeout: number = 5000
): Promise<HttpResponse<T>> {
    const cachedProtocol = getCachedProtocol(hostname, port);

    // If we know HTTP works, use it directly
    if (cachedProtocol === 'http') {
        return doRequest<T>(hostname, port, path, headers, body, timeout, 'http');
    }

    // Try HTTPS first
    try {
        return await doRequest<T>(hostname, port, path, headers, body, timeout, 'https');
    } catch (httpsError) {
        // HTTPS failed, try HTTP fallback
        try {
            const result = await doRequest<T>(hostname, port, path, headers, body, timeout, 'http');
            // Cache successful HTTP protocol
            setCachedProtocol(hostname, port, 'http');
            return result;
        } catch {
            // Both failed, throw original error
            throw httpsError;
        }
    }
}

/**
 * Internal: Execute single request
 */
function doRequest<T>(
    hostname: string,
    port: number,
    path: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeout: number,
    protocol: Protocol
): Promise<HttpResponse<T>> {
    return new Promise((resolve, reject) => {
        const requestModule = protocol === 'https' ? https : http;

        const requestOptions = {
            hostname,
            port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
                ...headers,
            },
            timeout,
            agent: false,
            // Safe for localhost communication with self-signed certificates
            ...(protocol === 'https' ? { rejectUnauthorized: false } : {}),
        };

        const req = requestModule.request(requestOptions, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => (responseBody += chunk));
            res.on('end', () => {
                const statusCode = res.statusCode || 0;
                try {
                    const data = responseBody ? JSON.parse(responseBody) as T : {} as T;
                    resolve({ statusCode, data, protocol });
                } catch {
                    if (statusCode >= 400) {
                        resolve({
                            statusCode,
                            data: { error: `HTTP ${statusCode}` } as unknown as T,
                            protocol,
                        });
                    } else {
                        reject(new Error(`Invalid JSON response`));
                    }
                }
            });
        });

        req.on('error', (err) => reject(new Error(`${protocol.toUpperCase()} request failed: ${err.message}`)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`${protocol.toUpperCase()} timeout`));
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * Test if server is available at given port (used for server verification)
 */
export async function testPort(
    hostname: string,
    port: number,
    path: string,
    headers: Record<string, string>,
    body?: string
): Promise<{ success: boolean; statusCode: number; protocol: Protocol }> {
    try {
        const response = await makeRequest(hostname, port, path, headers, body, 5000);
        return {
            success: response.statusCode === 200,
            statusCode: response.statusCode,
            protocol: response.protocol,
        };
    } catch (err) {
        console.error(`[httpClient] Port test failed:`, err instanceof Error ? err.message : err);
        return { success: false, statusCode: 0, protocol: 'https' };
    }
}
