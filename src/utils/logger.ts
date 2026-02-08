/**
 * Logger utility for VS Code extension
 * Provides logging to VS Code Output channel
 */

import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | null = null;

/**
 * Initialize the logger with an output channel
 */
export function initLogger(channelName: string = 'Antigravity Observer'): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel(channelName);
    }
    return outputChannel;
}

/**
 * Get the current output channel
 */
export function getLogger(): vscode.OutputChannel | null {
    return outputChannel;
}

/**
 * Log info message
 */
export function infoLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ℹ️ ${message}`;
    outputChannel?.appendLine(logMessage);
}

/**
 * Log warning message
 */
export function warnLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ⚠️ ${message}`;
    outputChannel?.appendLine(logMessage);
}

/**
 * Log error message
 */
export function errorLog(message: string, error?: any): void {
    const timestamp = new Date().toLocaleTimeString();
    let logMessage = `[${timestamp}] ❌ ${message}`;
    if (error) {
        if (error instanceof Error) {
            logMessage += `\n    Error: ${error.message}`;
            if (error.stack) {
                logMessage += `\n    Stack: ${error.stack}`;
            }
        } else {
            logMessage += `\n    Details: ${JSON.stringify(error)}`;
        }
    }
    outputChannel?.appendLine(logMessage);
}

/**
 * Log debug message (verbose)
 */
export function debugLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] 🔍 ${message}`;
    outputChannel?.appendLine(logMessage);
}

/**
 * Dispose the logger
 */
export function disposeLogger(): void {
    outputChannel?.dispose();
    outputChannel = null;
}
