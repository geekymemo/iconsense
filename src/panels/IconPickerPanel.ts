import * as vscode from 'vscode';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { CssScanner } from '../utils/CssScanner';
import { TreeShaker } from '../treeShaking/treeShaking';
import { IconDefinition } from '../types/icons';
import { FontManager } from '../utils/FontManager';
import { IconSenseState } from '../state/IconSenseState';
import { StandaloneScanner } from '../utils/StandaloneScanner';

export class IconPickerPanel {
    public static currentPanel: IconPickerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _extensionUri: vscode.Uri;
    private _targetEditor?: vscode.TextEditor;
    private _pendingGenerations = new Map<string, (data: string | null) => void>();
    private _mode?: 'standalone' | 'workspace';

    public generateIconImage(className: string): Promise<string | null> {
        return new Promise((resolve) => {
            const requestId = Math.random().toString(36).substring(7);

            // Set timeout to prevent hanging
            const timeout = setTimeout(() => {
                if (this._pendingGenerations.has(requestId)) {
                    this._pendingGenerations.delete(requestId);
                    resolve(null);
                }
            }, 1000);

            this._pendingGenerations.set(requestId, (data) => {
                clearTimeout(timeout);
                resolve(data);
            });

            this._panel.webview.postMessage({
                command: 'generateIcon',
                requestId,
                className,
            });
        });
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Initial load
        this.refresh();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message) => {
                switch (message.command) {
                    case 'insertIcon':
                        this._insertIcon(message.className);
                        return;
                    case 'refresh':
                        // Clear all caches and rescan
                        panel.onDidDispose(() => {
                            IconPickerPanel.currentPanel = undefined;
                        });
                        CssScanner.clearCache();
                        FontManager.clearCache();
                        TreeShaker.clearCache();
                        this.refresh();
                        return;
                    case 'openStatistics': {
                        const reports = TreeShaker.getTreeShakingReports();
                        this._panel.webview.postMessage({
                            command: 'showStatistics',
                            reports,
                        });
                        return;
                    }
                    case 'openSettings':
                        IconPickerPanel.currentPanel?.dispose();
                        vscode.commands.executeCommand('workbench.action.openSettings', 'iconsense');
                        return;
                    case 'iconGenerated':
                        const resolver = this._pendingGenerations.get(message.requestId);
                        if (resolver) {
                            resolver(message.data);
                            this._pendingGenerations.delete(message.requestId);
                        }
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(
        context: vscode.ExtensionContext,
        extensionUri: vscode.Uri,
        column?: vscode.ViewColumn,
        preserveFocus: boolean = false
    ) {
        const activeEditor = vscode.window.activeTextEditor;
        const targetColumn = column || (activeEditor ? activeEditor.viewColumn : vscode.ViewColumn.One);

        if (IconPickerPanel.currentPanel) {
            IconPickerPanel.currentPanel._targetEditor = activeEditor; // Update target on reveal

            if (activeEditor && StandaloneScanner.isStandaloneDocument(activeEditor.document.uri)) {
                IconPickerPanel.currentPanel._mode = 'standalone';
            } else {
                IconPickerPanel.currentPanel._mode = 'workspace';
            }

            IconPickerPanel.currentPanel._panel.reveal(targetColumn, preserveFocus);
            // Verify cache on reveal too
            IconPickerPanel.currentPanel.refresh();
            return;
        }

        // aktif dosyanın klasörü (standalone HTML için KRİTİK)
        const activeFileDir = activeEditor ? vscode.Uri.file(path.dirname(activeEditor.document.uri.fsPath)) : null;
        const workspaceRoots = vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];
        // standalone CSS klasörleri
        const standaloneCssDirs = StandaloneScanner.getIcons()
            .map((i) => i.sourceFile)
            .filter((f): f is string => !!f && !f.startsWith('http'))
            .map((f) => vscode.Uri.file(path.dirname(f)));

        const panel = vscode.window.createWebviewPanel(
            'iconsense',
            TreeShaker.detectedLibraries.length ? 'Icon Sense - Icon Picker' : 'Icon Sense',
            { viewColumn: targetColumn || vscode.ViewColumn.One, preserveFocus },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                //localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out'), ...workspaceRoots],
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out'),
                    ...workspaceRoots,
                    ...(activeFileDir ? [activeFileDir] : []),
                    ...standaloneCssDirs,
                ],
            }
        );

        IconPickerPanel.currentPanel = new IconPickerPanel(panel, extensionUri, context);
        IconPickerPanel.currentPanel._targetEditor = activeEditor; // Set target on create
    }
    public async refresh() {
        // Show loading state first
        this._panel.webview.html = this._getLoadingHtml();

        if (this._mode === 'standalone') {
            if (this._targetEditor) {
                StandaloneScanner.clear();
                this._hardResetWebview();
                await StandaloneScanner.scanStandaloneDocument(this._targetEditor.document);
            }
        } else {
            // Force refresh of icons
            const treeShakeDiagnostics = vscode.languages.createDiagnosticCollection('tree-shaking');
            TreeShaker.clearCache?.();
            await CssScanner.scanWorkspace(treeShakeDiagnostics, false);
        }

        // Update with new data
        this._update();
    }
    private _hardResetWebview() {
        // Webview state tamamen sıfırlanır
        this._panel.webview.html = '';

        // microtask delay (VS Code webview race fix)
        setTimeout(() => {
            this._panel.webview.html = this._getLoadingHtml();
            this._update();
        }, 0);
    }
    private _insertIcon(className: string) {
        // Use the captured target editor if the current one is not active (due to focus loss)
        let editor = vscode.window.activeTextEditor;

        if (!editor && this._targetEditor && !this._targetEditor.document.isClosed) {
            editor = this._targetEditor;
        }

        if (editor) {
            editor
                .edit((editBuilder) => {
                    editor?.selections.forEach((selection) => {
                        editBuilder.insert(selection.active, className);
                    });
                })
                .then((success) => {
                    if (success) {
                        vscode.window.showInformationMessage(`Inserted: ${className}`);
                    } else {
                        vscode.window.showErrorMessage('Failed to insert icon.');
                    }
                });
        } else {
            vscode.window.showErrorMessage('No active text editor to insert icon.');
        }
    }
    //panel kaldığı yerden devam etsin. extension.ts den çağıralım
    public static restore(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        IconPickerPanel.currentPanel = new IconPickerPanel(panel, extensionUri, context);
    }
    public dispose() {
        IconPickerPanel.currentPanel = undefined;
        this._context.globalState.update('iconsense.panelOpen', false);
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getNoLibraryHtml(webview: vscode.Webview) {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: sans-serif;
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    text-align: center;
                }
                .box {
                    max-width: 420px;
                }
                h2 {
                    margin-bottom: 10px;
                }
                p {
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                    margin-bottom: 20px;
                }
                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 14px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>No icon library detected</h2>
                <p>
                    IconSense couldn't find any supported icon library in this workspace.
                    Make sure Font Awesome, Bootstrap Icons, Flaticon or Boxicons are properly loaded.
                </p>
                <button onclick="openSettings()">Open IconSense Settings</button>
                <button onclick="refreshIcons()">Refesh</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                function openSettings() {
                    vscode.postMessage({ command: 'openSettings' });
                }
                    function refreshIcons() {
                vscode.postMessage({ command: 'refresh' });
            }
            </script>
        </body>
        </html>
    `;
    }

    private _getLoadingHtml() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { 
                        font-family: sans-serif; 
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        height: 100vh; 
                        background-color: var(--vscode-editor-background); 
                        color: var(--vscode-editor-foreground);
                        flex-direction: column;
                    }
                    .spinner {
                        border: 4px solid var(--vscode-widget-border);
                        border-top: 4px solid var(--vscode-progressBar-background);
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin-bottom: 20px;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                 <h1>Scanning icons…</h1>
                <div class="spinner"></div>
                <div>Scanning workspace for icons...</div>
            </body>
            </html>
        `;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        //1. Collect Sources (Local files and Remote URLs)
        const localCssFiles = new Set<string>();
        const remoteCssUrls = new Set<string>();
        //const activeEditor = vscode.window.activeTextEditor;
        //const isStandalone = activeEditor && StandaloneScanner.isStandaloneDocument(activeEditor.document.uri);

        if (!IconSenseState.ready) {
            return this._getLoadingHtml();
        }
        // if (!isStandalone && (!TreeShaker.detectedLibraries || TreeShaker.detectedLibraries.length === 0)) {
        //     return this._getNoLibraryHtml(webview);
        // }
        if (this._mode === 'workspace') {
            if (!TreeShaker.detectedLibraries?.length) {
                return this._getNoLibraryHtml(webview);
            }
        }

        if (this._mode === 'standalone') {
            localCssFiles.clear();
            remoteCssUrls.clear();
            StandaloneScanner.clear();
            this._hardResetWebview();
            if (!StandaloneScanner.getIcons().length) {
                return this._getNoLibraryHtml(webview);
            }
        }

        const config = vscode.workspace.getConfiguration('iconsense');
        const showIconIndex = config.get<boolean>('debug.showIconIndex', false);

        //const icons = CssScanner.getIcons();

        const workspaceIcons = CssScanner.getIcons();
        const standaloneIcons = StandaloneScanner.hasActiveStandaloneIcons() ? StandaloneScanner.getIcons() : [];

        // birleşik liste (ama işaretli)
        const icons = [
            ...workspaceIcons.map((i) => ({ ...i, __source: 'workspace' })),
            ...standaloneIcons.map((i) => ({ ...i, __source: 'standalone' })),
        ];

        if (icons.length === 0) {
            return this._getNoLibraryHtml(webview);
        }

        // Deduplicate icons by className
        const uniqueIconsMap = new Map<string, IconDefinition>();
        icons.forEach((icon) => {
            const key = `${icon.className}|${icon.prefix}|${icon.sourceFile}`;
            if (!uniqueIconsMap.has(key)) {
                uniqueIconsMap.set(key, icon);
            }
        });
        const uniqueIcons = Array.from(uniqueIconsMap.values());

        // Collect unique fonts
        const uniqueFonts = new Map<string, { fontFamily: string; fontUrl: string }>();
        //uniq font-face listesi çıkar
        uniqueIcons.forEach((icon) => {
            if (!icon.fontUrl || !icon.fontFamily) return;

            const key = `${icon.fontFamily}::${icon.fontUrl}`;
            if (!uniqueFonts.has(key)) {
                uniqueFonts.set(key, {
                    fontFamily: icon.fontFamily,
                    fontUrl: icon.fontUrl,
                });
            }
        });
        //sadece bu uniq fontlar için font-face üret
        const fontFaceCss = Array.from(uniqueFonts.values())
            .map((font) => {
                const safeUrl = toWebviewFontUrl(font.fontUrl);
                return FontManager.getFontFaceCss(font.fontFamily, safeUrl);
            })
            .join('\n');

        const fontClassCss = Array.from(uniqueFonts.values())
            .map((font) => {
                const safeFamily = font.fontFamily.replace(/[^a-zA-Z0-9_-]/g, '');
                return `.iconfont-${safeFamily} {
                    font-family: '${font.fontFamily}';
                }`;
            })
            .join('\n');

        //console.log('fontFaceCss ' + fontFaceCss);
        const iconsJson = JSON.stringify(uniqueIcons);

        uniqueIcons.forEach((icon) => {
            if (icon.sourceFile) {
                if (icon.sourceFile.startsWith('http')) {
                    remoteCssUrls.add(icon.sourceFile);
                } else {
                    localCssFiles.add(icon.sourceFile);
                }
            }
        });
        const styleTags = [
            // Remote
            ...Array.from(remoteCssUrls).map((url) => `<link rel="stylesheet" href="${url}">`),
            // Local (converted to Webview URI)
            ...Array.from(localCssFiles).map((file) => {
                const uri = vscode.Uri.file(file);
                const webviewUri = webview.asWebviewUri(uri);
                return `<link rel="stylesheet" href="${webviewUri}">`;
            }),
        ].join('\n');

        function toWebviewFontUrl(fontUrl: string): string {
            if (fontUrl.startsWith('http')) return fontUrl;

            const uri = vscode.Uri.file(fontUrl.trim());
            const webviewUri = webview.asWebviewUri(uri);
            return `${webviewUri}`;

            // LOCAL FILE → webview uri
            //const uri = vscode.Uri.file(fontUrl);
            //return webview.asWebviewUri(vscode.Uri.file(fontUrl.trim())).toString();
        }

        //  ${fontFaceCss} <---bu arkadaşı kaldırıyoruz çünkü unicode karışıklığı css içindeymiş
        //  ${fontClassCss} <---bu arkadaşı kaldırıyoruz çünkü unicode karışıklığı css içindeymiş
        // Styles
        const style = `
            .icon-source-badge {
                position: absolute;
                top: 4px;
                right: 4px;
                font-size: 9px;
                padding: 2px 6px;
                border-radius: 4px;
                background: #1976d2;
                color: white;
                font-family: monospace;
            }
            .icon-source-badge.standalone {
                background: #7b1fa2;
            }
           .iconfont-fix {font-family: var(--icon-font-family) !important;}
            body { font-family: sans-serif; padding: 10px; }
             .icon-info-modal {
                position: fixed;
                z-index: 9999;
                pointer-events: auto;
            }

            .icon-info-card {
                background: #1f1f1f;
                color: #ddd;
                border: 1px solid #333;
                border-radius: 10px;
                min-width: 280px;
                max-width: 420px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                padding: 12px 14px;
                animation: fadeIn 0.12s ease-out;
                font-size: 12px;
            }

            .icon-info-card .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: 600;
                margin-bottom: 8px;
                color: #fff;
            }

            .icon-info-card .close {
                cursor: pointer;
            }
            .icon-info-card .close:hover {
                opacity: 1;
            }

            .icon-info-card .row {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 4px 0;
                border-bottom: 1px solid #2a2a2a;
            }
            .icon-info-card .row:last-child {
                border-bottom: none;
            }

            .icon-info-card .row span:first-child {
                color: #888;
                flex-shrink: 0;
            }

            .icon-info-card .row span:last-child {
                color: #fff;
                text-align: right;
                word-break: break-all;
            }

            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
            .modal {
                position: fixed;
                inset: 0;
                display: none;
                z-index: 9999;
            }

            .modal[style*="flex"] {
                display: flex;
            }

            .modal-backdrop {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.55);
            }

            .modal-body {
                position: relative;
                margin: auto;
                width: 680px;
                max-width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                border-radius: 8px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
                padding: 20px 24px 24px;
            }

            /* Header */
            .modal-body header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 16px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--vscode-widget-border);
            }

            .modal-body header h2 {
                font-size: 16px;
                font-weight: 600;
                margin: 0;
            }

            /* Close button */
            .close,.modal-body header button {
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 50%;
                background: #d32f2f;
                color: #fff;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .modal-body header button:hover {
                background: #b71c1c;
            }

            /* Stat block */
            .stat-block {
                border: 1px solid var(--vscode-widget-border);
                border-radius: 6px;
                padding: 14px 16px;
                margin-bottom: 16px;
                background: var(--vscode-editor-background);
            }

            .stat-block h3 {
                margin: 0 0 10px;
                font-size: 14px;
                font-weight: 600;
            }

            /* Rows */
            .stat-block .row {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                padding: 4px 0;
                color: var(--vscode-descriptionForeground);
            }

            /* Severity */
            .stat-block .severity {
                margin-top: 10px;
                padding: 8px 10px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
            }

            .stat-block .severity.danger {
                background: rgba(211, 47, 47, 0.15);
                color: #ef5350;
            }

            .stat-block .severity.warn {
                background: rgba(255, 193, 7, 0.15);
                color: #ffca28;
            }

            /* Hint */
            .stat-block .hint {
                margin-top: 10px;
                padding: 10px;
                border-radius: 4px;
                background: var(--vscode-textBlockQuote-background);
                font-size: 11px;
                white-space: pre-wrap;
                color: var(--vscode-editor-foreground);
            }
            .icon-item { 
                border: 1px solid var(--vscode-widget-border); 
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                padding: 10px; 
                text-align: center; 
                border-radius: 4px;
                transition: transform 0.1s;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                align-items: center;
                cursor: pointer;
            }
            .icon-item:hover { 
                background: var(--vscode-list-hoverBackground); 
            }
            .preview { 
                font-size: 24px; 
                margin-bottom: 5px; 
                display: block;
                height: 30px;
                line-height: 30px;
            }
            .name { font-size: 11px; margin-bottom: 8px; word-break: break-all; color: var(--vscode-descriptionForeground); }
            .prefix-container {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                gap: 2px;
                width: 100%;
                margin-top: auto;
            }
            .prefix-btn {
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: none;
                border-radius: 2px;
                font-size: 9px;
                padding: 4px 6px;
                cursor: pointer;
                opacity: 0.7;
            }
            .prefix-btn:hover {
                opacity: 1;
            }
            .prefix-btn.active {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                opacity: 1;
                font-weight: bold;
            }
            .filter-container { margin-bottom: 15px; position: sticky; top: 0; background: var(--vscode-editor-background); padding: 10px 0; z-index: 100; display: flex; gap: 10px; align-items: center;}
            .filter-container input {
                flex: 1;  
                outline:none;
                color: var(--vscode-button-foreground);
                focus: bone; 
                background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px;  padding: 8px 10px; }
            .refresh-btn {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
            }
                .statistic-btn {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
               
                padding: 6px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
            }
            .statistic-btn,.refresh-btn:hover {
                background: var(--vscode-button-hoverBackground);
            }
            input:focus { border-color: var(--vscode-focusBorder); }
            .loading { text-align: center; padding: 20px; color: var(--vscode-descriptionForeground); }
            .icon-item {
                position: relative;
            }

            .icon-index-badge {
                position: absolute;
                top: 4px;
                left: 4px;
                font-size: 9px;
                line-height: 1;
                padding: 2px 5px;
                border-radius: 4px;
                background: rgba(0, 0, 0, 0.65);
                color: #fff;
                font-family: monospace;
                pointer-events: none;
                z-index: 2;
            }
        `;

        const jsonlocalfiles = JSON.stringify(Array.from(localCssFiles), null, 2);
        const jsonremotefiles = JSON.stringify(Array.from(remoteCssUrls), null, 2);
        const csslinks = JSON.stringify(styleTags.replace(/</g, '').replace(/>/g, ''));

        // Script (Client-Side)
        const script = `
                const vscode = acquireVsCodeApi();
                const SHOW_ICON_INDEX = ${showIconIndex ? 'true' : 'false'};
                const allIcons = ${iconsJson};
                
                function openSettingsPickerPanel() {
                    vscode.postMessage({ command: 'openSettings' });
                }

              function openIconInfo(icon, i, event) {
                const modal = document.getElementById('icon-info-modal');
                document.getElementById('info-class').textContent = icon.className || '-';
                document.getElementById('info-prefix').textContent = icon.detectedFontType || '-';
                document.getElementById('info-font').textContent = icon.fontFamily || '-';
                document.getElementById('info-url').textContent = icon.fontUrl || '-';
                document.getElementById('info-number').textContent = i+1;

                document.getElementById('lib-id').textContent = icon.library?.id || '-';
                document.getElementById('lib-name').textContent = icon.library?.displayName || '-';
                document.getElementById('lib-shortname').textContent = icon.library?.shortName || '-';
                document.getElementById('lib-version').textContent = icon.library?.version || '-';
                document.getElementById('lib-path').textContent = icon.library?.cssPath || '-';
                document.getElementById('lib-confidence').textContent = icon.library?.confidence || '-';

                document.getElementById('icon-info-modal').style.display = 'flex';

                modal.style.display = 'block';

                const padding = 8;

                // İlk pozisyon (mouse sağı-altı)
                let x = event.clientX + padding;
                let y = event.clientY + padding;

                // Modal ölçülerini al
                const modalRect = modal.getBoundingClientRect();
                const vw = window.innerWidth;
                const vh = window.innerHeight;

                // Sağdan taşıyorsa → sola al
                if (x + modalRect.width > vw) {
                    x = event.clientX - modalRect.width - padding;
                }

                // Alttan taşıyorsa → yukarı al
                if (y + modalRect.height > vh) {
                    y = event.clientY - modalRect.height - padding;
                }

                // Negatif olmasın (ekran dışına kaçmasın)
                x = Math.max(padding, x);
                y = Math.max(padding, y);

                modal.style.left = x + 'px';
                modal.style.top = y + 'px';
            }
            document.addEventListener('click', (e) => {
                const modal = document.getElementById('icon-info-modal');
                if (!modal.contains(e.target)) {
                    closeIconInfo();
                }
            });

            function closeIconInfo() {
                document.getElementById('icon-info-modal').style.display = 'none';
            }

            function refreshIcons() {
                vscode.postMessage({ command: 'refresh' });
            }
            function openStatsModal() {
                vscode.postMessage({ command: 'openStatistics' });
            }
            
            function openModal() {
                document.getElementById('stats-modal').style.display = 'flex';
            }
            function closeStatsModal() {
                document.getElementById('stats-modal').style.display = 'none';
            }
            
            function openJsonModal() {
                openModal();
                const container = document.getElementById('stats-content');
                container.innerHTML = '';
                container.innerHTML = '${iconsJson}';
            }
           
            function openSourceModal() {
                openModal();
                const container = document.getElementById('stats-content');
                container.innerHTML = '';
                container.innerHTML =
                '<h3>Local CSS Files</h3>' +
                '<pre>' + JSON.stringify(${jsonlocalfiles}, null, 2) + '</pre>' +
                '<h3>Remote CSS URLs</h3>' +
                '<pre>' + JSON.stringify(${jsonremotefiles}, null, 2) + '</pre>' +
                '<h3>CSS Link For Header</h3>' +
                '<pre>' + ${csslinks} + '</pre>';
            }

            // Render Statistics
            function renderStatistics(reports) {
                const container = document.getElementById('stats-content');
                container.innerHTML = '';

                reports.forEach(r => {
                    const ratio = ((r.usedIcons / r.totalIcons) * 100).toFixed(6);

                    const block = document.createElement('div');
                    block.className = 'stat-block';

                    block.innerHTML = \`
                        <h3>\${r.library} (\${r.displayName})</h3>

                        <div class="row"><span>Total icons</span><span>\${r.totalIcons}</span></div>
                        <div class="row"><span>Used icons</span><span>\${r.usedIcons}</span></div>
                        <div class="row"><span>Usage ratio</span><span>\${ratio}%</span></div>

                        <div class="severity \${r.severity}">
                            \${r.severity === 'danger'
                                ? '⚠ Tree-shaking strongly recommended'
                                : '⚠ Tree-shaking recommended'}
                        </div>

                        \${r.hint ? \`<pre class="hint">\${r.hint}</pre>\` : ''}
                    \`;

                    container.appendChild(block);
                });
            }

            // Message Handler
            window.addEventListener('message', event => {
                const message = event.data;

                if (message.command === 'showStatistics') {
                    renderStatistics(message.reports);
                    openModal();
                }
            });
            async function renderIcons() {
                const grid = document.querySelector('.grid');
                grid.innerHTML = '<div class="loading">Loading icons...</div>';
                
                // Wait for fonts to be fully loaded
                await document.fonts.ready;
                // Extra delay to ensure fonts are rendered
                await new Promise(r => setTimeout(r, 500));
                
                grid.innerHTML = '';
                
                const chunkSize = 50;
                let index = 0;

                async function processChunk() {
                    const end = Math.min(index + chunkSize, allIcons.length);
                    const fragment = document.createDocumentFragment();

                    for (let i = index; i < end; i++) {
                        const icon = allIcons[i];

                        const item = document.createElement('div');
                        item.className = 'icon-item';
                        item.setAttribute('data-name', icon.className);
                        
                        // Icon Preview
                        const iTag = document.createElement('i');

                        const isBoxicons = icon.library?.shortName === 'BX';
                        const isBootstrap = icon.library?.shortName === 'BI';
                        const isFontAwesome = icon.library?.shortName === 'FA';

                        // ---- PREFIX TEK KAYNAK ----
                        const prefixes = icon.detectedFontType && icon.detectedFontType.length  ? icon.detectedFontType : isBootstrap ? ['bi'] : isBoxicons ? ['bx'] : ['fas'];

                        let currentPrefix = prefixes[0];
                       
                        item.setAttribute('data-prefix', currentPrefix);
                        iTag.className = currentPrefix + ' ' + icon.className + ' preview';
                        //iTag.style.fontFamily = icon.fontFamily;
                        //const safeFamily = icon.fontFamily.replace(/[^a-zA-Z0-9_-]/g, '');
                        //iTag.classList.add('iconfont-' + safeFamily);
                        //iTag.classList.add('iconfont-fix');
                        //iTag.style.setProperty('font-family', icon.fontFamily);
                        
                        // Name Label
                        const nameDiv = document.createElement('div');
                        nameDiv.className = 'name';
                        nameDiv.textContent = icon.className;

                        item.appendChild(iTag);
                        item.appendChild(nameDiv);
                        if (SHOW_ICON_INDEX) {
                        const indexBadge = document.createElement('span');
                        indexBadge.className = 'icon-index-badge';
                        indexBadge.textContent = i + 1;
                        item.appendChild(indexBadge);
}
                        // ---- Prefix Buttons (SADECE Font Awesome) ----
                        if (isFontAwesome) {
                            // SADECE Font Awesome
                            const prefixContainer = document.createElement('div');
                            prefixContainer.className = 'prefix-container';

                            const prefixes = icon.detectedFontType?.length
                                ? icon.detectedFontType
                                : ['fas', 'far', 'fab', 'fal', 'fad', 'fa'];

                            prefixes.forEach(p => {
                                const btn = document.createElement('button');
                                btn.className = 'prefix-btn';
                                if (p === currentPrefix) btn.classList.add('active');
                                btn.textContent = p;

                                btn.onclick = (e) => {
                                    e.stopPropagation();
                                    currentPrefix = p;
                                    item.setAttribute('data-prefix', p);
                                    iTag.className = p +' '+ icon.className +' preview';

                                    Array.from(prefixContainer.children).forEach(b => b.classList.remove('active'));
                                    btn.classList.add('active');
                                };

                                prefixContainer.appendChild(btn);
                            });

                            item.appendChild(prefixContainer);
                        }
                        
                        // Main Click Handler (Insert)
                        item.onclick = () => {
                            const prefix = item.getAttribute('data-prefix');
                            selectIcon(prefix + ' ' + icon.className);
                        };

                        // Context Menu (Info)
                        item.oncontextmenu = (e) => {
                            e.preventDefault();
                            openIconInfo(icon, i, event);
                        };

                        fragment.appendChild(item);
                    }
                    
                    grid.appendChild(fragment);
                    index = end;
                    
                    if (index < allIcons.length) {
                        requestAnimationFrame(processChunk);
                    } else {
                        // All icons rendered, fix invisible ones
                        //setTimeout(fixInvisibleIcons, 100);
                        requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            fixInvisibleIcons();
                        });
                    });
                    }
                }

                processChunk();
            }
            
            // Fix icons that didn't render with the default prefix
            function fixInvisibleIcons() {
                console.log('fixInvisibleIcons: Starting...');
                const prefixes = ['fas', 'far', 'fab', 'fal', 'fad', 'fa'];
                const items = document.querySelectorAll('.icon-item');
                console.log('fixInvisibleIcons: Found', items.length, 'items');
                let fixedCount = 0;
                
                items.forEach(item => {
                    const iTag = item.querySelector('i.preview');
                    if (!iTag) return;
                    
                    const content = window.getComputedStyle(iTag, '::before').content;
                    const className = item.getAttribute('data-name');
                    
                    // If content is empty or 'none', try other prefixes
                    if (!content || content === 'none' || content === '""' || content === "''") {
                        const className = item.getAttribute('data-name');
                        const currentPrefix = item.getAttribute('data-prefix');
                        
                        // Try each prefix
                        for (const prefix of prefixes) {
                            if (prefix === currentPrefix) continue;
                            
                            iTag.className = prefix + ' ' + className + ' preview';
                            const newContent = window.getComputedStyle(iTag, '::before').content;
                            
                            if (newContent && newContent !== 'none' && newContent !== '""' && newContent !== "''") {
                                // Found working prefix, update state
                                item.setAttribute('data-prefix', prefix);
                                
                                // Update button states
                                const buttons = item.querySelectorAll('.prefix-btn');
                                buttons.forEach(btn => {
                                    btn.classList.remove('active');
                                    if (btn.textContent === prefix) {
                                        btn.classList.add('active');
                                    }
                                });
                                fixedCount++;
                                console.log('Fixed icon:', className, 'from', currentPrefix, 'to', prefix);
                                break;
                            }
                        }
                    }
                });
                console.log('fixInvisibleIcons: Completed, fixed', fixedCount, 'icons');
            }

            function filterIcons() {
                const query = document.getElementById('search').value.toLowerCase();
                const items = document.querySelectorAll('.icon-item');
                items.forEach(item => {
                    const name = item.getAttribute('data-name').toLowerCase();
                    if (name.includes(query)) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                });
            }

            function selectIcon(fullClass) {
                vscode.postMessage({ command: 'insertIcon', className: fullClass });
            }
            
            // Message Handler
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'generateIcon') {
                    handleGenerateIcon(message.requestId, message.className);
                }
            });

            async function handleGenerateIcon(requestId, className) {
                try {
                    // Create off-screen canvas
                    const canvas = document.createElement('canvas');
                    canvas.width = 64;
                    canvas.height = 64;
                    const ctx = canvas.getContext('2d');

                    // Create temp icon to get styles
                    const iTag = document.createElement('i');
                    iTag.className = className;
                    iTag.style.position = 'absolute';
                    iTag.style.left = '-9999px';
                    iTag.style.fontSize = '48px';
                    document.body.appendChild(iTag);

                    // Wait for render/styles?
                    // Just a small tick to ensure styles are applied
                    await new Promise(r => setTimeout(r, 10));

                    const style = window.getComputedStyle(iTag, '::before');
                    const content = style.content.replace(/['"]/g, ''); // Remove quotes
                    const fontFamily = window.getComputedStyle(iTag).fontFamily;
                    const color = window.getComputedStyle(iTag).color;

                    document.body.removeChild(iTag);

                    if (!content || content === 'none') {
                        vscode.postMessage({ command: 'iconGenerated', requestId, data: null });
                        return;
                    }

                    // Draw
                    ctx.clearRect(0, 0, 64, 64);
                    ctx.fillStyle = color; 
                    // Fallback font + captured font
                    ctx.font = \`48px \${fontFamily}\`; 
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(content, 32, 32);

                    const dataUrl = canvas.toDataURL('image/png');
                    vscode.postMessage({ command: 'iconGenerated', requestId, data: dataUrl });

                } catch (e) {
                    vscode.postMessage({ command: 'iconGenerated', requestId, data: null });
                }
            }
            
            window.addEventListener('load', renderIcons);
        `;

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!-- Injected Stylesheets -->
              
               
                ${styleTags} 
                 <style>${style}</style> 
            </head>
            <body>
             <div id="icon-info-modal" class="icon-info-modal" style="display:none;">
                <div class="icon-info-card">
                    <div class="header">
                        Icon Info
                        <span class="close" onclick="closeIconInfo()">×</span>
                    </div>

                    <div class="row"><span>Class</span><span id="info-class"></span></div>
                    <div class="row"><span>Prefix</span><span id="info-prefix"></span></div>
                    <div class="row"><span>Font Family (Hashed)</span><span id="info-font"></span></div>
                    <div class="row"><span>Font URL</span><span id="info-url"></span></div>
                    <div class="row"><span>Icon Number</span><span id="info-number">-</span></div>
               
                    <div class="header" style="margin-top:20px; padding-top:10px; border-top:1px solid #333; background:#222;">
                        Library Info
                    </div>
                     <div class="row"><span>Library Id</span><span id="lib-id"></span></div>
                     <div class="row"><span>Library Name</span><span id="lib-name"></span></div>
                     <div class="row"><span>Library Short Name</span><span id="lib-shortname"></span></div>
                     <div class="row"><span>Library Version</span><span id="lib-version"></span></div>
                     <div class="row"><span>Library Path/URL</span><span id="lib-path"></span></div>
                     <div class="row"><span>Library Confidence</span><span id="lib-confidence"></span></div>
                    </div>
            </div>
                <div id="stats-modal" class="modal">
                <div class="modal-backdrop"></div>
                <div class="modal-body">
                    <header>
                        <h2>IconSense — Tree-shaking statistics</h2>
                        <button class='modalkapat' onclick="closeStatsModal()">✕</button>
                    </header>
                    <div id="stats-content"></div>
                </div>
            </div>
                <div class="filter-container">
                    <input type="text" id="search" placeholder="Search icons..." onkeyup="filterIcons()">
                    <button class="refresh-btn" onclick="refreshIcons()">Refresh</button>
                     <button class="statistic-btn" onclick="openStatsModal()"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 48 48">
	                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"> <path d="M6 6v36h36" /> 
                        <path d="m14 34l8-16l10 9L42 6" /></g></svg>
                    </button>
                     <button class="statistic-btn" onclick="openJsonModal()">
                     <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
	                    <path fill="currentColor" d="M5 3h2v2H5v5a2 2 0 0 1-2 2a2 2 0 0 1 2 2v5h2v2H5c-1.07-.27-2-.9-2-2v-4a2 2 0 0 0-2-2H0v-2h1a2 2 0 0 0 2-2V5a2 2 0 0 1 2-2m14 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2a2 2 0 0 1-2-2V5h-2V3zm-7 12a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1m-4 0a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1m8 0a1 1 0 0 1 1 1a1 1 0 0 1-1 1a1 1 0 0 1-1-1a1 1 0 0 1 1-1" stroke-width="0.5" stroke="currentColor" />
                    </svg>
                    </button>
                     <button class="statistic-btn" onclick="openSourceModal()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
	                    <path fill="currentColor" d="M20 6h-8l-1.41-1.41C10.21 4.21 9.7 4 9.17 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-6 10H6v-2h8zm4-4H6v-2h12z" stroke-width="0.5" stroke="currentColor" />
                    </svg>
                    </button>
                     <button class="statistic-btn" onclick="openSettingsPickerPanel()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                        <g fill="none" stroke="currentColor" stroke-width="1">
                            <path d="m10.5 1.5l-.181.543a7 7 0 0 1-.716 1.514a4.63 4.63 0 0 1-3.717 2.146a7 7 0 0 1-1.668-.137l-.561-.115l-1.5 2.598l.38.429c.374.422.693.884.953 1.376a4.63 4.63 0 0 1 0 4.292a7 7 0 0 1-.953 1.376l-.38.429l1.5 2.598l.56-.115a7 7 0 0 1 1.67-.137a4.63 4.63 0 0 1 3.716 2.146c.296.47.537.979.716 1.514l.181.543h3l.181-.543q.27-.806.716-1.514a4.63 4.63 0 0 1 3.717-2.146a7 7 0 0 1 1.668.137l.561.115l1.5-2.598l-.38-.429a7 7 0 0 1-.953-1.376a4.63 4.63 0 0 1 0-4.292c.26-.492.579-.954.953-1.376l.38-.429l-1.5-2.598l-.56.115a7 7 0 0 1-1.67.137a4.63 4.63 0 0 1-3.716-2.146a7 7 0 0 1-.716-1.514L13.5 1.5z" />
                            <path d="M15.502 12a3.502 3.502 0 1 1-7.004 0a3.502 3.502 0 0 1 7.004 0Z" />
                        </g>
                    </svg>
                    </button>
                </div>
                <div class="grid">
                    <!-- Icons will be generated by script -->
                </div>
                <script>${script}</script>
            </body>
            </html>
        `;
    }
}
