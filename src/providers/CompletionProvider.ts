import * as vscode from 'vscode';
import { CssScanner } from '../utils/CssScanner';
// import {IconDefinition} from '../types/icons'

export class IconCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]> {

        const linePrefix = document.lineAt(position).text.substr(0, position.character);

        // Check if we are inside a class attribute of an <i> tag or similar
        // Simplest check: did the user type "<i class=" or similar?
        // Or if they are just inside class="..."

        if (!linePrefix.match(/class=["'][^"']*$/)) {
            return undefined;
        }

        const icons = CssScanner.getIcons();
        const completionItems: vscode.CompletionItem[] = [];

        for (const icon of icons) {
            const item = new vscode.CompletionItem(icon.className, vscode.CompletionItemKind.Value);
            item.detail = `CSS Icon: ${icon.className}`;

            // Try to show preview if we have the Unicode value
            if (icon.cssValue) {
                const unicodeChar = String.fromCharCode(parseInt(icon.cssValue, 16));
                item.documentation = new vscode.MarkdownString(`Icon Preview: ${unicodeChar} (\\${icon.cssValue})`);
            } else {
                item.documentation = new vscode.MarkdownString(`Defined in ${icon.sourceFile}`);
            }

            completionItems.push(item);
        }

        return completionItems;
    }
}
