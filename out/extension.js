"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const HoverProvider_1 = require("./providers/HoverProvider");
const CompletionProvider_1 = require("./providers/CompletionProvider");
const CssScanner_1 = require("./utils/CssScanner");
const treeShaking_1 = require("./treeShaking/treeShaking");
const IconPickerPanel_1 = require("./panels/IconPickerPanel");
const IconSenseState_1 = require("./state/IconSenseState");
const config = vscode.workspace.getConfiguration('iconSense');
const showNotifications = config.get('showNotifications', true);
const autoOpenIconPickerPanel = config.get('autoOpenIconPickerPanel', true);
let statusBarItem;
function createStatusBar(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(symbol-icon) IconSense';
    statusBarItem.tooltip = 'Open Icon Picker';
    statusBarItem.command = 'iconsense.openPicker';
    statusBarItem.hide();
    context.subscriptions.push(statusBarItem);
}
async function initializeIconSense(context, diagnostics) {
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'IconSense: Scanning icons...',
            cancellable: false
        }, async () => {
            await CssScanner_1.CssScanner.scanWorkspace(diagnostics, true);
        });
        IconSenseState_1.IconSenseState.ready = true;
        statusBarItem.show();
        if (treeShaking_1.TreeShaker.detectedLibraries.length > 0) {
            vscode.window.showInformationMessage('IconSense is ready');
        }
        if (IconSenseState_1.IconSenseState.ready) {
            const shouldRestorePanel = context.globalState.get('iconsense.panelOpen');
            if (shouldRestorePanel) {
                if (treeShaking_1.TreeShaker.detectedLibraries.length > 0) {
                    IconPickerPanel_1.IconPickerPanel.currentPanel?.refresh();
                }
                else {
                    IconPickerPanel_1.IconPickerPanel.currentPanel?.dispose();
                }
            }
        }
    }
    catch (err) {
        console.error('IconSense initialization failed', err);
    }
}
function activate(context) {
    context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('iconsense', {
        async deserializeWebviewPanel(panel, state) {
            IconPickerPanel_1.IconPickerPanel.restore(panel, context.extensionUri, context);
            if (IconPickerPanel_1.IconPickerPanel.currentPanel) {
                IconPickerPanel_1.IconPickerPanel.currentPanel.refresh();
            }
            context.globalState.update('iconsense.panelOpen', true);
        }
    }));
    console.log('Congratulations, your extension "IconSense" is now active!');
    createStatusBar(context);
    context.subscriptions.push(vscode.commands.registerCommand('iconsense.openPicker', () => {
        if (!IconSenseState_1.IconSenseState.ready) {
            if (!IconSenseState_1.IconSenseState.warnedNotReady) {
                vscode.window.showInformationMessage('IconSense is still initializing...');
                IconSenseState_1.IconSenseState.warnedNotReady = true;
            }
            return;
        }
        IconPickerPanel_1.IconPickerPanel.createOrShow(context, context.extensionUri, vscode.ViewColumn.Beside, false);
    }));
    const diagnostics = vscode.languages.createDiagnosticCollection('tree-shaking');
    initializeIconSense(context, diagnostics);
    const hoverProvider = vscode.languages.registerHoverProvider(['html', 'css', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact'], new HoverProvider_1.ImageHoverProvider());
    const completionProvider = vscode.languages.registerCompletionItemProvider(['html', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact'], new CompletionProvider_1.IconCompletionProvider(), '=', '"', '\'', ' ');
    let debounceTimer = null;
    const DEBOUNCE_DELAY = 500;
    let lastForceTime = 0;
    const FORCE_INTERVAL = 5 * 60 * 1000;
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{html,css,js,ts,jsx,tsx,vue}');
    let treeShakingNotificationShown = false;
    const scheduleScan = (uri) => {
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            try {
                const now = Date.now();
                const force = now - lastForceTime >= FORCE_INTERVAL;
                await CssScanner_1.CssScanner.scanWorkspace(diagnostics, force);
                if (force) {
                    lastForceTime = now;
                }
                const reports = treeShaking_1.TreeShaker.getTreeShakingReports();
                const dangerousReports = reports.filter(r => r.severity === 'danger');
                if (dangerousReports.length && showNotifications && !treeShakingNotificationShown) {
                    vscode.window.showWarningMessage(`Tree-shaking issue: ${dangerousReports.map(r => `${r.library}: ${r.usedIcons}/${r.totalIcons}`).join(', ')}`);
                    treeShakingNotificationShown = true;
                }
            }
            catch (e) {
                console.error('Tree-shaking scan failed:', e);
            }
        }, DEBOUNCE_DELAY);
    };
    watcher.onDidChange(scheduleScan);
    watcher.onDidCreate(scheduleScan);
    watcher.onDidDelete(scheduleScan);
    context.subscriptions.push(watcher, diagnostics);
    const convertToSvgCommand = vscode.commands.registerCommand('iconsense.convertToSvg', async (args) => {
        if (!args?.svg || !args?.range)
            return;
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const document = editor.document;
        const range = new vscode.Range(new vscode.Position(args.range.start.line, args.range.start.character), new vscode.Position(args.range.end.line, args.range.end.character));
        await editor.edit(editBuilder => {
            editBuilder.replace(range, args.svg);
        });
    });
    context.subscriptions.push(hoverProvider, completionProvider, convertToSvgCommand);
    const checkContext = () => {
        if (!autoOpenIconPickerPanel)
            return;
        if (!IconSenseState_1.IconSenseState.ready)
            return;
        if (treeShaking_1.TreeShaker.detectedLibraries.length === 0)
            return;
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        if (IconPickerPanel_1.IconPickerPanel.currentPanel)
            return;
        const position = editor.selection.active;
        const lineText = editor.document.lineAt(position.line).text;
        const character = position.character;
        const textBefore = lineText.slice(0, character);
        const textAfter = lineText.slice(character);
        if (!/<i\b[^>]*class\s*=\s*["'][^"']*$/.test(textBefore)) {
            return;
        }
        const quoteUsed = textBefore.at(-1);
        if (!quoteUsed || !textAfter.startsWith(quoteUsed))
            return;
        IconPickerPanel_1.IconPickerPanel.createOrShow(context, context.extensionUri, vscode.ViewColumn.Beside, true);
    };
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(checkContext), vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === vscode.window.activeTextEditor?.document) {
            checkContext();
        }
    }));
}
function deactivate() {
}
//# sourceMappingURL=extension.js.map