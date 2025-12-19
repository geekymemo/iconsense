import * as vscode from 'vscode';
import { ImageHoverProvider } from './providers/HoverProvider';
import { IconCompletionProvider } from './providers/CompletionProvider';
import { CssScanner } from './utils/CssScanner';
import { TreeShaker } from './treeShaking/treeShaking';
import { IconPickerPanel } from './panels/IconPickerPanel';
import { IconSenseState } from './state/IconSenseState';



const config = vscode.workspace.getConfiguration('iconSense');

const showNotifications = config.get<boolean>('showNotifications', true);
const autoOpenIconPickerPanel = config.get<boolean>('autoOpenIconPickerPanel', true);


let statusBarItem: vscode.StatusBarItem;

// function closeEmptyEditors() {
//     const allTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);

//     for (const tab of allTabs) {
//         // Tab'ın hiç input'u yoksa → boş sekme
//         if (!tab.input) {
//             vscode.window.tabGroups.close(tab);
//         }
//     }
// }

function createStatusBar(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );

    statusBarItem.text = '$(symbol-icon) IconSense';
    statusBarItem.tooltip = 'Open Icon Picker';
    statusBarItem.command = 'iconsense.openPicker';

    // Başta görünmez
    statusBarItem.hide();

    context.subscriptions.push(statusBarItem);
}
async function initializeIconSense(context: vscode.ExtensionContext, diagnostics: vscode.DiagnosticCollection) {

    //closeEmptyEditors();
    // //Tüm açık tablar
    //     const allTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    //     //Boş ve kaydedilmemiş tabları filtrele
    //     const emptyUntitledTabs = allTabs.filter(tab => {
    //         const input = tab.input;
    //         // TextEditorInput ve UntitledDocument kontrolü
    //         if (input instanceof vscode.TabInputText && input.uri.scheme === '') {
    //             // Tab boş mu kontrol edelim (document.getText)
    //             const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === input.uri.toString());
    //             return doc && doc.getText().trim() === '';
    //         }
    //         return false;
    //     });
    //     //Boş tabları kapat
    //     for (const tab of emptyUntitledTabs) {
    //         vscode.window.tabGroups.close(tab);
    //     }

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: 'IconSense: Scanning icons...',
                cancellable: false
            },
            async () => {
                await CssScanner.scanWorkspace(diagnostics, true);
            }
        );

        //buraya açılışta eğer varsa boş sekmeleri kapatma kodu eklenecek. bazen bir önceki sekmenin boş hali kalabiliyor.
        IconSenseState.ready = true;
        statusBarItem.show();
        if (TreeShaker.detectedLibraries.length > 0) { vscode.window.showInformationMessage('IconSense is ready'); }


        if (IconSenseState.ready) {
            const shouldRestorePanel =
                context.globalState.get<boolean>('iconsense.panelOpen');
            if (shouldRestorePanel) {
                if (TreeShaker.detectedLibraries.length > 0) {
                    IconPickerPanel.currentPanel?.refresh();
                }
                else {
                    IconPickerPanel.currentPanel?.dispose();
                }
            }
        }

    } catch (err) {
        console.error('IconSense initialization failed', err);
    }
}

export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer('iconsense', {
            async deserializeWebviewPanel(panel, state) {
                //Restore etme → direkt kapat
                //panel.dispose();
                // Panel VS Code tarafından restore edildi
                IconPickerPanel.restore(panel, context.extensionUri, context);


                // Henüz scan bitmemiş olabilir → placeholder
                if (IconPickerPanel.currentPanel) {
                    IconPickerPanel.currentPanel.refresh();
                }

                // Panel açık state
                context.globalState.update('iconsense.panelOpen', true);
            }
        })
    );

    console.log('Congratulations, your extension "IconSense" is now active!');

    // 1 Status bar'ı hazırla (ama gösterme)
    createStatusBar(context);

    // 2 Panel komutu
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'iconsense.openPicker',
            () => {
                if (!IconSenseState.ready) {
                    if (!IconSenseState.warnedNotReady) {
                        vscode.window.showInformationMessage(
                            'IconSense is still initializing...'
                        );
                        IconSenseState.warnedNotReady = true;
                    }
                    return;
                }

                IconPickerPanel.createOrShow(
                    context,
                    context.extensionUri,
                    vscode.ViewColumn.Beside,
                    false
                );
            }
        )
    );

    const diagnostics = vscode.languages.createDiagnosticCollection('tree-shaking');
    // 3 Arka planda taramayı başlat
    initializeIconSense(context, diagnostics);

    // Register Hover Provider
    const hoverProvider = vscode.languages.registerHoverProvider(
        ['html', 'css', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
        new ImageHoverProvider()
    );

    // Register Completion Provider
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        ['html', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
        new IconCompletionProvider(),
        '=', '"', '\'', ' ' // Trigger characters
    );

    // 3. File watcher
    let debounceTimer: NodeJS.Timeout | null = null;
    const DEBOUNCE_DELAY = 500; // 500ms
    let lastForceTime = 0;
    const FORCE_INTERVAL = 5 * 60 * 1000; // 5 dakika
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{html,css,js,ts,jsx,tsx,vue}');
    let treeShakingNotificationShown = false;
    const scheduleScan = (uri: vscode.Uri) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            try {

                const now = Date.now();
                const force = now - lastForceTime >= FORCE_INTERVAL;

                // Workspace'i tara
                await CssScanner.scanWorkspace(diagnostics, force);

                if (force) {
                lastForceTime = now; // force kullanıldıysa zamanı güncelle
              }

                // Tree-shaking raporlarını al
                const reports = TreeShaker.getTreeShakingReports();

                // 4. Notification
                const dangerousReports = reports.filter(r => r.severity === 'danger');
                if (dangerousReports.length && showNotifications && !treeShakingNotificationShown) {
                    vscode.window.showWarningMessage(
                        `Tree-shaking issue: ${dangerousReports.map(r => `${r.library}: ${r.usedIcons}/${r.totalIcons}`).join(', ')}`
                    );
                    treeShakingNotificationShown = true;
                }
            } catch (e) {
                console.error('Tree-shaking scan failed:', e);
            }
        }, DEBOUNCE_DELAY);
    };

    watcher.onDidChange(scheduleScan);
    watcher.onDidCreate(scheduleScan);
    watcher.onDidDelete(scheduleScan);

    context.subscriptions.push(watcher, diagnostics);

    // convert to svg
    // const convertToSvgCommand = vscode.commands.registerCommand(
    //     'iconsense.convertToSvg',
    //     async (args) => {
    //         if (!args || !args.svg) return;

    //         const editor = vscode.window.activeTextEditor;
    //         if (!editor) return;

    //         const document = editor.document;
    //         const selection = editor.selection;

    //         // Seçili değilse cursor'un olduğu tagı bulalım
    //         const range = document.getWordRangeAtPosition(selection.active, /<i[^>]*>.*?<\/i>/);
    //         if (!range) return;

    //         await editor.edit(editBuilder => {
    //             editBuilder.replace(range, args.svg);
    //         });
    //     }
    // );
    // const convertToSvgCommand = vscode.commands.registerCommand(
    //     'iconsense.convertToSvg',
    //     async (args) => {
    //         if (!args || !args.svg) return;

    //         const editor = vscode.window.activeTextEditor;
    //         if (!editor) return;

    //         const document = editor.document;
    //         const position = editor.selection.active;

    //         const range = findNearestITagRange(document, position);
    //         if (!range) {
    //             vscode.window.showWarningMessage('No <i> tag found near cursor.');
    //             return;
    //         }

    //         await editor.edit(editBuilder => {
    //             editBuilder.replace(range, args.svg);
    //         });
    //     }
    // );
    //   function findNearestITagRange(
    //         document: vscode.TextDocument,
    //         position: vscode.Position
    //     ): vscode.Range | null {
    //         const text = document.getText();
    //         const offset = document.offsetAt(position);
    
    //         // Cursor’dan geriye doğru <i ...> ara
    //         const startIndex = text.lastIndexOf('<i', offset);
    //         if (startIndex === -1) return null;
    
    //         // Cursor’dan ileri doğru </i> ara
    //         const endIndex = text.indexOf('</i>', offset);
    //         if (endIndex === -1) return null;
    
    //         const startPos = document.positionAt(startIndex);
    //         const endPos = document.positionAt(endIndex + 4); // </i> length
    
    //         return new vscode.Range(startPos, endPos);
    //     }

    const convertToSvgCommand = vscode.commands.registerCommand(
  'iconsense.convertToSvg',
  async (args) => {
    if (!args?.svg || !args?.range) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;

    const range = new vscode.Range(
      new vscode.Position(args.range.start.line, args.range.start.character),
      new vscode.Position(args.range.end.line, args.range.end.character)
    );

    await editor.edit(editBuilder => {
      editBuilder.replace(range, args.svg);
    });
  }
);

    context.subscriptions.push(hoverProvider, completionProvider, convertToSvgCommand);

  



    //Auto-Open Icon Picker Panel - Yeni versiyon (daha iyi çalışıyor)
    const checkContext = () => {
        if (!autoOpenIconPickerPanel) return;
        if (!IconSenseState.ready) return;
        if (TreeShaker.detectedLibraries.length === 0) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        // Panel zaten açıksa tekrar açma
        if (IconPickerPanel.currentPanel) return;

        const position = editor.selection.active;
        const lineText = editor.document.lineAt(position.line).text;
        const character = position.character;

        const textBefore = lineText.slice(0, character);
        const textAfter = lineText.slice(character);

        // Daha esnek ama güvenli regex
        if (!/<i\b[^>]*class\s*=\s*["'][^"']*$/.test(textBefore)) {
            return;
        }

        const quoteUsed = textBefore.at(-1);
        if (!quoteUsed || !textAfter.startsWith(quoteUsed)) return;

        IconPickerPanel.createOrShow(
            context,
            context.extensionUri,
            vscode.ViewColumn.Beside,
            true
        );
    };

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(checkContext),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === vscode.window.activeTextEditor?.document) {
                checkContext();
            }
        })
    );

    // Auto-open listener eski versiyon, ama iş görüyordu
    // const checkContext = () => {
    //     const editor = vscode.window.activeTextEditor;
    //     if (!editor) { return; }

    //     const position = editor.selection.active;
    //     const lineText = editor.document.lineAt(position.line).text;

    //     // We need to be careful with bounds
    //     const character = position.character;
    //     const textBefore = lineText.substring(0, character);
    //     const textAfter = lineText.substring(character);

    //     // Regex to check if we are inside an <i> tag's class attribute
    //     // Looks for: <i (space) (anything but >) class=" (at end of string)
    //     if (/<i\s+[^>]*class=["']$/i.test(textBefore)) {

    //         if (!IconSenseState.ready) {
    //             if (!IconSenseState.warnedNotReady) {
    //                 vscode.window.showInformationMessage(
    //                     'IconSense is still initializing...'
    //                 );
    //                 IconSenseState.warnedNotReady = true;
    //             }
    //             return;
    //         }

    //         // Determine which quote was used (last char of textBefore)
    //         const quoteUsed = textBefore.charAt(textBefore.length - 1);

    //         // Check if the text after starts with the matching closing quote
    //         if (textAfter.startsWith(quoteUsed)) {
    //             IconPickerPanel.createOrShow(context.extensionUri, vscode.ViewColumn.Beside, true);
    //         }
    //     }
    // };

    // const selectionListener = vscode.window.onDidChangeTextEditorSelection(checkContext);
    // const docListener = vscode.workspace.onDidChangeTextDocument(event => {
    //     const editor = vscode.window.activeTextEditor;
    //     if (editor && event.document === editor.document &&autoOpenIconPickerPanel && TreeShaker.detectedLibraries.length>0) {
    //         checkContext();
    //     }
    // });

    // context.subscriptions.push(selectionListener, docListener);
}

export function deactivate() {

}
