import * as vscode from 'vscode';
import { discoverLanguageServer } from './platform/processDiscovery';
import { fetchQuotaData, QuotaData } from './services/quotaService';
import { initLogger, infoLog, warnLog, errorLog, debugLog, disposeLogger } from './utils/logger';

let myStatusBarItem: vscode.StatusBarItem;
let latestQuota: QuotaData | null = null; // Store latest quota data for commands
let lastSuccessfulQuota: QuotaData | null = null; // Cache last successful fetch
let lastSuccessfulTime: number = 0; // Track data freshness
let isUserLoggedIn: boolean = true; // Track login state (assume logged in initially)
let refreshInterval: NodeJS.Timeout; // Polling interval timer

/**
 * Restart polling interval with current state-based interval
 */
function restartPolling() {
    clearInterval(refreshInterval);
    refreshInterval = setInterval(refreshQuota, getCurrentRefreshInterval());
    infoLog(`[Extension] Polling interval adjusted to ${getCurrentRefreshInterval() / 1000}s (logged ${isUserLoggedIn ? 'IN' : 'OUT'})`);
}

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    const logger = initLogger('Antigravity Observer');
    context.subscriptions.push(logger);

    infoLog('=== ANTIGRAVITY OBSERVER ACTIVATED ===');

    // 1. Status Bar Item
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = 'antigravity-observer.selectModels';
    myStatusBarItem.text = `$(database) Quota`;
    myStatusBarItem.tooltip = "Click to select models";
    myStatusBarItem.show();
    context.subscriptions.push(myStatusBarItem);

    // 2. Refresh Command
    let refreshCommand = vscode.commands.registerCommand('antigravity-quota.refresh', () => {
        refreshQuota();
    });
    context.subscriptions.push(refreshCommand);

    // 3. Select Models Command (Interactive QuickPick with real-time updates)
    let selectModelsCommand = vscode.commands.registerCommand('antigravity-observer.selectModels', async () => {
        if (!latestQuota || !latestQuota.models || latestQuota.models.length === 0) {
            if (!isUserLoggedIn) {
                vscode.window.showInformationMessage('Not logged in. Please sign in to Antigravity to view quota.');
            } else {
                vscode.window.showWarningMessage('No quota data available. Please wait for refresh.');
            }
            return;
        }

        const config = vscode.workspace.getConfiguration('antigravity-observer');
        const currentSelection = config.get<string[]>('selectedModels', []);

        // Create QuickPick items (sorted alphabetically to match tooltip)
        const sortedModels = [...latestQuota.models].sort((a: any, b: any) =>
            a.label.localeCompare(b.label)
        );

        const items = sortedModels.map((m: any) => ({
            label: m.label,
            description: `${m.remainingPercentage.toFixed(0)}% remaining`,
            picked: currentSelection.includes(m.label)
        }));

        // Create interactive QuickPick
        const quickPick = vscode.window.createQuickPick();
        quickPick.items = items;
        quickPick.canSelectMany = true;
        quickPick.placeholder = 'Select models to display in Status Bar (leave empty for default first 3)';
        quickPick.selectedItems = items.filter((item: { label: string; description: string; picked: boolean }) => item.picked);

        // Real-time update on selection change
        quickPick.onDidChangeSelection(async (selected) => {
            const labels = selected.map((item: any) => item.label);
            await config.update('selectedModels', labels, vscode.ConfigurationTarget.Global);

            // Update UI immediately (no hide/show needed - updates instantly)
            updateStatusBarFromQuota(latestQuota, labels);
        });

        // Accept handler (Enter key)
        quickPick.onDidAccept(() => {
            quickPick.hide();
        });

        // Close handler
        quickPick.onDidHide(() => quickPick.dispose());

        quickPick.show();
    });
    context.subscriptions.push(selectModelsCommand);

    // Initial update
    setTimeout(refreshQuota, 2000); // Small delay to let server start

    // Set up polling with dynamic interval (adjusts based on login state)
    refreshInterval = setInterval(refreshQuota, getCurrentRefreshInterval());

    // Listen for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('antigravity-observer.refreshRate')) {
            // Restart interval with new rate
            restartPolling();
            infoLog(`[Extension] Refresh rate updated to ${getRefreshInterval() / 1000}s`);
        }
        // Refresh immediately on any relevant config change
        if (e.affectsConfiguration('antigravity') || e.affectsConfiguration('cursor')) {
            setTimeout(refreshQuota, 1000);
        }
    }));
}

/**
 * Generate tooltip content with model list and selection markers
 * 2-level marker system:
 * • = Displayed in sidebar (primary)
 * ○ = Selected in QuickPick but not in sidebar (secondary)
 * (space) = Neither
 */
function generateTooltip(quota: any, modelsDisplayedInSidebar: any[], selectedModels: string[]): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('|   | Model | Quota | Reset |\n');
    tooltip.appendMarkdown('|:---|:------|:------|:------|\n');

    // Create sets for quick lookup
    const displayedLabels = new Set(modelsDisplayedInSidebar.map((m: any) => m.label));
    const selectedLabels = new Set(selectedModels);

    // Sort models alphabetically by label
    const sortedModels = [...quota.models].sort((a: any, b: any) => a.label.localeCompare(b.label));

    sortedModels.forEach((m: any) => {
        const emoji = getStatusEmoji(m.remainingPercentage);
        const isDisplayed = displayedLabels.has(m.label);
        const isSelected = selectedLabels.has(m.label);

        // Marker priority:
        // 1. Displayed in sidebar (•) - highest priority
        // 2. Selected in QuickPick but not displayed (○)
        // 3. Neither ( )
        let marker = ' ';
        if (isDisplayed) {
            marker = '•';  // Sidebar display (primary)
        } else if (isSelected) {
            marker = '○';  // QuickPick selection only (secondary)
        }

        tooltip.appendMarkdown(
            `| ${marker} | ${emoji} ${m.label} | ${m.remainingPercentage.toFixed(0)}% | ${m.timeUntilReset} |\n`
        );
    });

    return tooltip;
}

/**
 * Update Status Bar from quota data without touching tooltip (prevents flash)
 */
function updateStatusBarFromQuota(quota: any, selectedModels: string[]) {
    const percentage = quota.remainingPercentage;

    let modelsToShow = quota.models;
    if (selectedModels.length > 0) {
        // Filter by selection, then sort by: % → reset → name
        modelsToShow = quota.models
            .filter((m: any) => selectedModels.includes(m.label))
            .sort((a: any, b: any) => {
                if (a.remainingPercentage !== b.remainingPercentage) {
                    return a.remainingPercentage - b.remainingPercentage;
                }
                if (a.resetTime && b.resetTime) {
                    const timeDiff = a.resetTime.getTime() - b.resetTime.getTime();
                    if (timeDiff !== 0) return timeDiff;
                }
                return a.label.localeCompare(b.label);
            });
    } else {
        // Show 3 most used models with multi-level sort:
        // 1. Lowest remaining % (most used)
        // 2. Earliest reset time (sooner reset)
        // 3. Alphabetical by name
        modelsToShow = [...quota.models].sort((a: any, b: any) => {
            // Level 1: Remaining percentage (ascending - lower % = more used)
            if (a.remainingPercentage !== b.remainingPercentage) {
                return a.remainingPercentage - b.remainingPercentage;
            }
            // Level 2: Reset time (ascending - earlier reset = higher priority)
            if (a.resetTime && b.resetTime) {
                const timeDiff = a.resetTime.getTime() - b.resetTime.getTime();
                if (timeDiff !== 0) return timeDiff;
            }
            // Level 3: Alphabetical by label
            return a.label.localeCompare(b.label);
        }).slice(0, 3);
    }

    if (modelsToShow.length > 0) {
        const modelParts = modelsToShow.map((m: any) => {
            const emoji = getStatusEmoji(m.remainingPercentage);
            return `${emoji} ${m.label} ${m.remainingPercentage.toFixed(0)}%`;
        });
        myStatusBarItem.text = modelParts.join(' | ');
    } else if (selectedModels.length > 0 && modelsToShow.length === 0) {
        myStatusBarItem.text = `$(eye-closed) No models`;
    } else {
        const emoji = getStatusEmoji(percentage);
        myStatusBarItem.text = `${emoji} ${percentage.toFixed(0)}%`;
    }

    // Update tooltip too (happens while StatusBarItem is hidden, so no flash)
    if (quota.models && quota.models.length > 0) {
        myStatusBarItem.tooltip = generateTooltip(quota, modelsToShow, selectedModels);
    } else {
        myStatusBarItem.tooltip = new vscode.MarkdownString(`Remaining: ${percentage.toFixed(1)}%`);
    }
}

/**
 * Main function: Discover server and fetch quota (silent background refresh)
 */
async function refreshQuota() {
    try {
        // 1. Discover Language Server process (silent)
        const serverInfo = await discoverLanguageServer();

        if (!serverInfo) {
            debugLog('[Extension] Server not found - keeping previous display');
            // On first load, show helpful message
            if (!lastSuccessfulQuota) {
                myStatusBarItem.text = "$(error) Server Not Found";
                myStatusBarItem.tooltip = "Language Server not running. Start Antigravity first.";
            }
            return;
        }

        // 2. Fetch quota data (silent)
        const quota = await fetchQuotaData(serverInfo);

        if (!quota) {
            debugLog('[Extension] Fetch failed - keeping previous display');
            // On first load, show helpful message
            if (!lastSuccessfulQuota) {
                myStatusBarItem.text = "$(warning) Error";
                myStatusBarItem.tooltip = "Failed to fetch quota";
            }
            return;
        }

        // 3. Check for LOGGED OUT state
        debugLog(`[Extension] Quota received, isLoggedIn: ${quota.isLoggedIn}, models: ${quota.models?.length || 0}`);

        if (!quota.isLoggedIn) {
            warnLog('[Extension] ⚠️⚠️⚠️ USER IS LOGGED OUT ⚠️⚠️⚠️');
            myStatusBarItem.text = "$(database) Quota";
            myStatusBarItem.tooltip = "Not logged in. Sign in to Antigravity to view quota.";
            myStatusBarItem.command = undefined;  // Disable click
            latestQuota = null;  // Clear quota data

            // Update state and restart polling with aggressive interval
            if (isUserLoggedIn) {
                infoLog('[Extension] State transition: logged in → logged out');
                isUserLoggedIn = false;
                restartPolling();

                // Show notification to user
                vscode.window.showWarningMessage(
                    'Antigravity: Not logged in. Please sign in to view quota.',
                    'OK'
                );
            }
            return;
        }

        // 4. Detect LOGIN TRANSITION (logged out → logged in)
        if (!isUserLoggedIn) {
            infoLog('[Extension] 🎉 User just logged in! Updating UI immediately.');
            isUserLoggedIn = true;
            restartPolling();  // Switch to normal interval

            // Show welcome notification
            vscode.window.showInformationMessage(
                'Antigravity: Successfully logged in! Quota data updated.',
                'OK'
            );
        }

        // 5. SUCCESS - Update cache
        lastSuccessfulQuota = quota;
        lastSuccessfulTime = Date.now();
        latestQuota = quota;
        myStatusBarItem.command = 'antigravity-observer.selectModels';  // Re-enable click

        // Extract quota values
        const percentage = quota.remainingPercentage;

        // Get selected models from config
        const config = vscode.workspace.getConfiguration('antigravity-observer');
        const selectedModels = config.get<string[]>('selectedModels', []);

        // 6. Update Status Bar
        let modelsToShow = quota.models;
        if (selectedModels.length > 0) {
            // Filter by selection, then sort by: % → reset → name
            modelsToShow = quota.models
                .filter(m => selectedModels.includes(m.label))
                .sort((a: any, b: any) => {
                    if (a.remainingPercentage !== b.remainingPercentage) {
                        return a.remainingPercentage - b.remainingPercentage;
                    }
                    if (a.resetTime && b.resetTime) {
                        const timeDiff = a.resetTime.getTime() - b.resetTime.getTime();
                        if (timeDiff !== 0) return timeDiff;
                    }
                    return a.label.localeCompare(b.label);
                });
        } else {
            // Show 3 most used models with multi-level sort:
            // 1. Lowest remaining % (most used)
            // 2. Earliest reset time (sooner reset)
            // 3. Alphabetical by name
            modelsToShow = [...quota.models].sort((a: any, b: any) => {
                // Level 1: Remaining percentage (ascending - lower % = more used)
                if (a.remainingPercentage !== b.remainingPercentage) {
                    return a.remainingPercentage - b.remainingPercentage;
                }
                // Level 2: Reset time (ascending - earlier reset = higher priority)
                if (a.resetTime && b.resetTime) {
                    const timeDiff = a.resetTime.getTime() - b.resetTime.getTime();
                    if (timeDiff !== 0) return timeDiff;
                }
                // Level 3: Alphabetical by label
                return a.label.localeCompare(b.label);
            }).slice(0, 3);
        }

        if (modelsToShow.length > 0) {
            const modelParts = modelsToShow.map(m => {
                const emoji = getStatusEmoji(m.remainingPercentage);
                return `${emoji} ${m.label} ${m.remainingPercentage.toFixed(0)}%`;
            });
            myStatusBarItem.text = modelParts.join(' | ');
        } else if (selectedModels.length > 0 && modelsToShow.length === 0) {
            // Selection resulted in no models
            myStatusBarItem.text = `$(eye-closed) No models`;
        } else {
            // Fallback to total credits
            const emoji = getStatusEmoji(percentage);
            myStatusBarItem.text = `${emoji} ${percentage.toFixed(0)}%`;
        }

        // 7. Update Tooltip
        if (quota.models && quota.models.length > 0) {
            myStatusBarItem.tooltip = generateTooltip(quota, modelsToShow, selectedModels);
        } else {
            myStatusBarItem.tooltip = new vscode.MarkdownString(`Remaining: ${percentage.toFixed(1)}%`);
        }


    } catch (error) {
        // Silent error - log but don't change UI
        errorLog('[Extension] Refresh error', error);
        // On first load, show error
        if (!lastSuccessfulQuota) {
            myStatusBarItem.text = "$(error) Error";
            myStatusBarItem.tooltip = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
}

/**
 * Get base refresh interval in milliseconds from config
 */
function getRefreshInterval(): number {
    const config = vscode.workspace.getConfiguration('antigravity-observer');
    const seconds = config.get<number>('refreshRate', 60);
    return Math.max(30, seconds) * 1000; // Minimum 30 seconds (reduced server load)
}

/**
 * Get current refresh interval based on login state
 * Logged out: 10s (aggressive polling to detect login)
 * Logged in: user config (default 60s)
 */
function getCurrentRefreshInterval(): number {
    if (!isUserLoggedIn) {
        return 10 * 1000;  // Aggressive 10s polling when logged out
    }
    return getRefreshInterval();  // Normal interval when logged in
}

/**
 * Get status emoji based on remaining percentage
 */
function getStatusEmoji(percentage: number): string {
    if (percentage <= 20) return '🔴';
    if (percentage <= 40) return '🟡';
    return '🟢';
}

export function deactivate() {
    infoLog('=== ANTIGRAVITY OBSERVER DEACTIVATED ===');
    disposeLogger();
}
