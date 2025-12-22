import * as vscode from 'vscode';
import * as path from 'path';
import { IconDefinition } from '../types/icons';
import { fetchUrlCached } from './CssFetch';
import { CssScanner } from './CssScanner';
import { getCommentRanges } from './CommentRanges';

const standaloneLanguages = new Set(['html', 'php']);
export class StandaloneScanner {
    private static activeIcons: IconDefinition[] = [];
    private static activeUri: string | null = null;
    private static _active = false;

    // Standalone scan
    public static async scanStandaloneDocument(document: vscode.TextDocument): Promise<IconDefinition[]> {
        const uri = document.uri.toString();

        //  Aynı dosyaysa tekrar tarama
        if (this.activeUri === uri) {
            return this.activeIcons;
        }

        // Başka standalone dosyaya geçildiyse temizle
        if (this.activeUri && this.activeUri !== uri) {
            this.clear();
        }

        if (this.activeUri === document.uri.toString()) {
            return this.activeIcons;
        }

        if (!this.isStandaloneDocument(document.uri)) {
            this.clear();
            return [];
        }
        if (!standaloneLanguages.has(document.languageId)) {
            this.clear();
            return [];
        }
        const text = document.getText();

        // if (!text.includes('class=') && !text.includes('icon-') && !text.includes('fa-') && !text.includes('ti-')) {
        //     this.clear();
        //     return [];
        // }

        const icons: IconDefinition[] = [];
        const commentRanges = await getCommentRanges(text);
        const cssLinks = this.extractCssLinksFromHtml(text, commentRanges);

        for (const link of await cssLinks) {
            try {
                if (link.startsWith('http')) {
                    const css = await fetchUrlCached(link);
                    icons.push(...(await CssScanner.extractIcons(css, link)));
                } else {
                    const resolved = path.resolve(path.dirname(document.uri.fsPath), link);
                    icons.push(...(await CssScanner.parseCssFile(resolved)));
                }
            } catch {
                console.warn('[Standalone CSS load failed]', link);
            }
        }

        // STATE’E YAZ
        this.activeIcons = icons;
        this.activeUri = document.uri.toString();
        this._active = icons.length > 0;
        // console.log('[StandaloneScanner] scanStandaloneDocument called');
        // console.log('[StandaloneScanner] file:', document.uri.fsPath);
        // console.log('[StandaloneScanner] language:', document.languageId);
        return icons;
    }

    public static isSameDocument(document: vscode.TextDocument): boolean {
        return this.activeUri === document.uri.toString();
    }

    // helpers
    public static hasActiveStandaloneIcons(): boolean {
        return this._active && this.activeIcons.length > 0;
    }

    public static getIcons(): IconDefinition[] {
        return this.activeIcons;
    }

    public static isStandaloneDocument(uri: vscode.Uri): boolean {
        return !vscode.workspace.getWorkspaceFolder(uri);
    }

    private static extractCssLinksFromHtml(text: string, commentRanges: { start: number; end: number }[]): string[] {
        const links: string[] = [];
        //const commentRanges = await getCommentRanges(text);

        const regex = /<link[^>]+href=["']([^"']+\.css)["']/gi;
        let match;

        while ((match = regex.exec(text))) {
            const index = match.index;

            const isInComment = commentRanges.some((r) => index >= r.start && index <= r.end);

            if (isInComment) continue; // COMMENT link pas geç

            links.push(match[1]); // AKTİF LINK
        }

        return links;
    }

    public static clear() {
        this.activeIcons = [];
        this.activeUri = null;
        this._active = false;
    }
}

// export class StandaloneScanner {
//     public static isStandaloneDocument(uri: vscode.Uri): boolean {
//         return !vscode.workspace.getWorkspaceFolder(uri);
//     }
//     //Standalone scan
//     public static async scanStandaloneDocument(
//         document: vscode.TextDocument
//     ): Promise<IconDefinition[]> {

//         if (!this.isStandaloneDocument(document.uri)) {
//             return [];
//         }

//         if (!standaloneLanguages.has(document.languageId)) {
//             return [];
//         }

//         const text = document.getText();

//         // hızlı içerik filtresi
//         if (
//             !text.includes('class=') &&
//             !text.includes('icon-') &&
//             !text.includes('fa-') &&
//             !text.includes('ti-')
//         ) {
//             return [];
//         }

//         const icons: IconDefinition[] = [];

//         // 1 Bu dosyanın içindeki <link href="">
//         const cssLinks = this.extractCssLinksFromHtml(text);

//         // 2 Resolve path (aynı klasöre göre)
//         for (const link of cssLinks) {
//             try {
//                 if (link.startsWith('http')) {
//                     const css = await fetchUrlCached(link);
//                     icons.push(...await CssScanner.extractIcons(css, link));
//                 } else {
//                     const resolved = path.resolve(
//                         path.dirname(document.uri.fsPath),
//                         link
//                     );
//                     icons.push(...await CssScanner.parseCssFile(resolved));
//                 }
//             } catch (e) {
//                 console.warn('[Standalone CSS load failed]', link);
//             }
//         }

//         return icons;
//     }
//     private static extractCssLinksFromHtml(text: string): string[] {
//         const links: string[] = [];
//         const regex = /<link[^>]+href=["']([^"']+\.css)["']/gi;

//         let match;
//         while ((match = regex.exec(text))) {
//             links.push(match[1]);
//         }

//         return links;
//     }

// }
