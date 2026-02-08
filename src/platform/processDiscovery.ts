/**
 * Process Discovery - Finds Antigravity Language Server process and extracts credentials
 * Adapted from antigravity-panel-main/src/shared/platform/ambient_discovery.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { testPort } from '../utils/httpClient';
import { debugLog, errorLog } from '../utils/logger';

const execPromise = promisify(exec);

/**
 * Escape shell special characters for safe command construction
 */
function escapeShellArg(arg: string): string {
    return arg.replace(/[;&|`$()\\<>"']/g, '\\$&');
}

export interface ServerInfo {
    port: number;
    csrfToken: string;
}

interface ProcessInfo {
    pid: number;
    ppid: number;
    commandLine: string;
    port?: number;
    csrfToken?: string;
}

/**
 * Main entry point: Discover Antigravity Language Server
 */
export async function discoverLanguageServer(): Promise<ServerInfo | null> {
    debugLog('[Discovery] Starting Language Server discovery...');

    try {
        // 1. Find processes with csrf_token signature
        const processes = await findProcessesBySignature('csrf_token');
        if (processes.length === 0) {
            debugLog('[Discovery] No Language Server process found');
            return null;
        }

        debugLog(`[Discovery] Found ${processes.length} candidate process(es)`);

        // 2. Extract CSRF token and port from each process
        for (const proc of processes) {
            const extracted = extractCredentials(proc);
            if (!extracted.csrfToken) continue;

            // 3. Get listening ports for this PID
            const ports = await getListeningPorts(proc.pid);
            if (ports.length === 0) continue;

            debugLog(`[Discovery] Process ${proc.pid} has ${ports.length} listening port(s)`);

            // 4. Test each port to verify server
            for (const port of ports) {
                const verified = await verifyServer('127.0.0.1', port, extracted.csrfToken);
                if (verified) {
                    debugLog(`[Discovery] ✅ Server verified at port ${port}`);
                    return { port, csrfToken: extracted.csrfToken };
                }
            }
        }

        debugLog('[Discovery] No valid server found after verification');
        return null;
    } catch (error) {
        errorLog('[Discovery] Error:', error instanceof Error ? error.message : error);
        return null;
    }
}

/**
 * Find processes containing the signature string
 */
async function findProcessesBySignature(signature: string): Promise<ProcessInfo[]> {
    const safeSig = escapeShellArg(signature);

    if (process.platform !== 'win32') {
        // Unix-like systems
        const cmd = `ps -A -ww -o pid,ppid,args | grep "${safeSig}" | grep -v grep`;
        try {
            const { stdout } = await execPromise(cmd, { timeout: 10000 });
            return parseUnixOutput(stdout);
        } catch {
            return [];
        }
    }

    // Windows PowerShell - escape single quotes
    const psEscaped = signature.replace(/'/g, "''");
    const psScript = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
        $sign = '${psEscaped}';
        $pList = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match $sign } -ErrorAction SilentlyContinue;
        if ($pList) { @($pList) | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress } else { '[]' }
    `.replace(/\n\s+/g, ' ').trim();

    const cmd = `chcp 65001 >nul && powershell -ExecutionPolicy Bypass -NoProfile -Command "${psScript}"`;

    try {
        const { stdout } = await execPromise(cmd, { timeout: 15000 });
        return parseWindowsOutput(stdout);
    } catch {
        return [];
    }
}

/**
 * Parse Windows PowerShell JSON output
 */
function parseWindowsOutput(stdout: string): ProcessInfo[] {
    const processes: ProcessInfo[] = [];
    try {
        const data = JSON.parse(stdout.trim());
        const entries = Array.isArray(data) ? data : [data];

        for (const entry of entries) {
            if (entry.CommandLine && entry.ProcessId) {
                processes.push({
                    pid: entry.ProcessId,
                    ppid: entry.ParentProcessId || 0,
                    commandLine: entry.CommandLine,
                });
            }
        }
    } catch (err) {
        errorLog('[Discovery] Failed to parse Windows output:', err);
    }
    return processes;
}

/**
 * Parse Unix ps command output
 */
function parseUnixOutput(stdout: string): ProcessInfo[] {
    const processes: ProcessInfo[] = [];
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (match) {
            processes.push({
                pid: parseInt(match[1], 10),
                ppid: parseInt(match[2], 10),
                commandLine: match[3],
            });
        }
    }
    return processes;
}

/**
 * Extract CSRF token and port from command line
 */
function extractCredentials(proc: ProcessInfo): { csrfToken: string; port?: number } {
    const cmd = proc.commandLine;

    // Extract CSRF token (limited to prevent ReDoS)
    const tokenMatch = cmd.match(/--csrf_token[=\s]+(?:["']?)([a-zA-Z0-9\-_.]{1,128})(?:["']?)/);
    const csrfToken = tokenMatch?.[1] || '';

    // Extract extension server port (optional)
    const portMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/);
    const port = portMatch ? parseInt(portMatch[1], 10) : undefined;

    return { csrfToken, port };
}

/**
 * Get listening ports for a given PID
 */
async function getListeningPorts(pid: number): Promise<number[]> {
    let cmd: string;

    if (process.platform === 'win32') {
        cmd = `chcp 65001 >nul && netstat -ano | findstr "${pid}" | findstr "LISTENING"`;
    } else if (process.platform === 'darwin') {
        cmd = `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
    } else {
        // Linux
        cmd = `ss -tlnp 2>/dev/null | grep "pid=${pid}," || lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`;
    }

    try {
        const { stdout } = await execPromise(cmd, { timeout: 5000 });
        return extractPortsFromOutput(stdout, process.platform);
    } catch {
        return [];
    }
}

/**
 * Extract port numbers from netstat/lsof output
 */
function extractPortsFromOutput(output: string, platform: string): number[] {
    const ports: number[] = [];
    // Limited quantifiers to prevent ReDoS
    const regex = platform === 'win32'
        ? /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)\s+\S{1,100}\s+LISTENING/gi
        : /(?:TCP|UDP|LISTEN)\s+(?:\*|[\d.]{1,50}|\[[\da-f:]{1,50}\]):(\d+)/gi;

    let match;
    while ((match = regex.exec(output)) !== null) {
        const port = parseInt(match[1], 10);
        if (port > 0 && !ports.includes(port)) {
            ports.push(port);
        }
    }

    return ports;
}

/**
 * Verify server by making test request
 */
async function verifyServer(hostname: string, port: number, csrfToken: string): Promise<boolean> {
    const endpoint = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
    const headers = {
        'X-Codeium-Csrf-Token': csrfToken,
        'Connect-Protocol-Version': '1',
    };
    const body = JSON.stringify({ metadata: {} });

    const result = await testPort(hostname, port, endpoint, headers, body);
    return result.success;
}
