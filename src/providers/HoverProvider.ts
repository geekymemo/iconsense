import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import sizeOf from 'image-size';
import { CssScanner } from '../utils/CssScanner';
import { FontManager } from '../utils/FontManager';
import { IconSenseState } from '../state/IconSenseState';
import { detectFontUrlName } from '../utils/library-detectors';

export class ImageHoverProvider implements vscode.HoverProvider {
    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        if (!IconSenseState.ready) {
            return null;
        }
        const range = document.getWordRangeAtPosition(position, /([a-zA-Z0-9\s_\-\.\/]+\.(png|jpg|jpeg|gif|svg|webp))|([a-zA-Z0-9_\-]+)/);
        if (!range) {
            return null;
        }

        const word = document.getText(range);

        // Case 1: Image file path
        if (word.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) {
            return this.provideImageHover(document, word);
        }

        // Case 2: CSS Class (potential icon)
        // Check for CSS classes in the word
        const icons = CssScanner.getIcons();
        const matchedIcon = icons.find((i) => i.className === word);

        if (matchedIcon) {
            let markdown = new vscode.MarkdownString(`**Icon:** \`${matchedIcon.className}\``);
            markdown.supportHtml = true;
            markdown.isTrusted = true;
            // Extract full class context
            const line = document.lineAt(position).text;
            let fullClass = matchedIcon.className;
            console.log("matchedIcon", matchedIcon);
            // Regex to capture content inside class="..." or class='...'
            const classMatch = line.match(/class=["']([^"']*)["']/);
            if (classMatch) {
                const classContent = classMatch[1];
                // Check if our cursor/word is actually inside this class content
                if (classContent.includes(word)) {
                    fullClass = classContent;
                }
            }

            // Generate SVG preview if unicode value is available
            if (matchedIcon.cssValue) {
                try {
                    // For alias icons, use the primary icon for SVG generation
                    let iconForPreview = matchedIcon;
                    // if (matchedIcon.isAlias && matchedIcon.primaryClassName) {
                    //     const primaryIcon = CssScanner.getIcons().find(
                    //         icon => icon.className === matchedIcon.primaryClassName
                    //     );
                    //     if (primaryIcon) {
                    //         iconForPreview = primaryIcon;
                    //         console.log(`Using primary icon ${primaryIcon.className} for alias ${matchedIcon.className}`);
                    //     }
                    // }

                    const expectedFontName = detectFontUrlName(fullClass); // solid / regular / brands
                    let fontUrl = iconForPreview.allFontUrls?.find(u => u.includes(expectedFontName));

                    if (!iconForPreview.cssValue) return null;

                    if (!fontUrl) {
                        // fullClass filtrelemediyse veya bulunamadıysa
                        fontUrl = await FontManager.findFontContainingGlyph(
                            parseInt(iconForPreview.cssValue, 16),
                            iconForPreview.allFontUrls || []
                        );
                    }

                    const font = await FontManager.loadFontFromUrl(fontUrl);
                    if (!font) return null;
                    const svgDataUri = FontManager.glyphToSvgDataUri(font, iconForPreview.cssValue);

                    if (!iconForPreview.cssValue) return null;
                    const range = this.findITagRange(document, position);
                    const rawSvg = FontManager.glyphToRawSvg(font, iconForPreview.cssValue);
                    if (svgDataUri) {
                        markdown.appendMarkdown(`\n\n**Preview:**\n\n`);
                        markdown.appendMarkdown(`![](${svgDataUri})\n\n`);
                        // markdown.appendMarkdown(`[🛠 Convert to SVG](command:iconsense.convertToSvg?${encodeURIComponent(JSON.stringify({
                        //     svg: rawSvg,
                        //     className: fullClass,
                        //     range: {
                        //         start: range?.start,
                        //         end: range?.end
                        //     }
                        // }))})`);

                        const linkHtml = `<a href="command:iconsense.convertToSvg?${encodeURIComponent(JSON.stringify({
                            svg: rawSvg,
                            className: fullClass,
                            range: {
                                start: range?.start,
                                end: range?.end
                            }
                        }))}" title="Click to convert icon to SVG">🛠 Convert to SVG</a>`;

                        markdown.appendMarkdown(linkHtml);

                        // Show detected font type
                        if (iconForPreview.detectedFontType) {
                            markdown.appendMarkdown(`\n\n**Detected Type:** \`${iconForPreview.detectedFontType}\``);
                        }
                    } else {
                        markdown.appendMarkdown(`\n\n(Preview generation failed)`);
                    }
                } catch (error) {
                    console.error('Error generating icon preview:', error);
                    markdown.appendMarkdown(`\n\n(Preview error)`);
                }

                //const unicodeChar = String.fromCharCode(parseInt(matchedIcon.cssValue, 16));
                markdown.appendMarkdown(`\n\n**Unicode:** \`${matchedIcon.cssValue}\``);

                // Show alias info if applicable
                if (matchedIcon.isAlias && matchedIcon.siblingClassNames &&
                    matchedIcon.siblingClassNames.length >= 2) {
                    const aliases = matchedIcon.siblingClassNames
                        .filter(name => name !== matchedIcon.className);

                    if (aliases.length) {
                        markdown.appendMarkdown(
                            `\n\n*Alias of:* ${aliases.map(a => `\`${a}\``).join(', ')}`
                        );
                    }
                }


            } else {
                markdown.appendMarkdown(`\n\n(No preview available)`);
            }

            // HTML Preview (Code Block) - use detected type if available
            markdown.appendMarkdown(`\n\n**HTML Preview:**\n`);
            let htmlPreviewClass = fullClass;
            if (matchedIcon.detectedFontType) {
                // Replace the prefix in fullClass with the detected one
                const iconClassName = matchedIcon.className;
                htmlPreviewClass = `${matchedIcon.detectedFontType} ${iconClassName}`;
            }
            markdown.appendCodeblock(`<i class="${htmlPreviewClass}"></i>`, 'html');

            if (matchedIcon.sourceFile && matchedIcon.library?.cssPath) {
                // const sourcefile = vscode.workspace.asRelativePath(matchedIcon.sourceFile);
                const relPath = vscode.workspace.asRelativePath(matchedIcon.library?.cssPath);
                //markdown.appendMarkdown(`\n\nSource File in: \`${sourcefile}\``);
                markdown.appendMarkdown(`\n\nDefined in: \`${relPath}\``);

                //bunu incele
                const isRemote = /^https?:\/\//i.test(matchedIcon.library?.cssPath);
                // if (!isRemote) {
                //     const uri = vscode.Uri.file(matchedIcon.library?.cssPath);

                //     markdown.appendMarkdown(
                //         `\n[Open CSS](command:vscode.open?${encodeURIComponent(
                //             JSON.stringify(uri)
                //         )})`
                //     );
                // }
                // else {
                //     markdown.appendMarkdown(
                //         `\n[Open CSS (CDN)](command:vscode.openExternal?${encodeURIComponent(
                //             JSON.stringify(vscode.Uri.parse(matchedIcon.library?.cssPath))
                //         )})`
                //     );
                // }
                if (!isRemote) {
                    const uri = vscode.Uri.file(matchedIcon.library?.cssPath);
                    const linkHtml = `<a href="command:vscode.open?${encodeURIComponent(
                        JSON.stringify(uri)
                    )}" title="Open local CSS file in editor">Open CSS</a>`;
                    markdown.appendMarkdown(`\n${linkHtml}`);
                } else {
                    const uri = vscode.Uri.parse(matchedIcon.library?.cssPath);
                    const linkHtml = `<a href="command:vscode.openExternal?${encodeURIComponent(
                        JSON.stringify(uri)
                    )}" title="Open remote CSS in browser">Open CSS (CDN)</a>`;
                    markdown.appendMarkdown(`\n${linkHtml}`);
                }
            }

            return new vscode.Hover(markdown);
        }

        // --- CASE 3: Inline <svg> tag hover preview ---
        const svgPreview = this.tryExtractInlineSvg(document, position);
        if (svgPreview) {
            const md = new vscode.MarkdownString();
            md.supportHtml = true;
            md.isTrusted = true;
            md.appendMarkdown(`**SVG Preview:**\n\n`);
            md.appendMarkdown(`![](${svgPreview})`);
            return new vscode.Hover(md);
        }

        // Check local image paths in src attributes
        const line = document.lineAt(position).text;
        const potentialPathMatch = line.match(/(?:src|href)=["']([^"']+\.(png|jpg|jpeg|gif|svg|webp))["']/i);

        if (potentialPathMatch) {
            const filePath = potentialPathMatch[1];
            if (filePath.includes(document.getText(range))) {
                return this.provideImageHover(document, filePath);
            }
        }

        return null;
    }
    private findITagRange(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Range | null {

        const text = document.getText();
        const offset = document.offsetAt(position);

        // multiline <i ...>...</i>
        const tagRegex = /<i\b[^>]*>[\s\S]*?<\/i>/gi;

        let match: RegExpExecArray | null;

        while ((match = tagRegex.exec(text))) {
            const start = match.index;
            const end = start + match[0].length;

            if (offset >= start && offset <= end) {
                return new vscode.Range(
                    document.positionAt(start),
                    document.positionAt(end)
                );
            }
        }

        return null;
    }


    private tryExtractInlineSvg(
        document: vscode.TextDocument,
        position: vscode.Position
    ): string | null {

        const text = document.getText();

        // Cursor <svg ...> alanı üzerinde mi?
        const offset = document.offsetAt(position);

        // En yakın <svg ...> başlangıcını bul
        const start = text.lastIndexOf("<svg", offset);
        if (start === -1) return null;

        // En yakın </svg> bitişini bul
        const end = text.indexOf("</svg>", start);
        if (end === -1) return null;

        const svgText = text.substring(start, end + "</svg>".length);
        const svgEnd = end + "</svg>".length;
        if (offset < start || offset > svgEnd) {
            return null; // cursor SVG'nin içinde değil
        }

        // Eğer fazla büyükse veya script içeriyorsa güvenlik için engelle
        if (svgText.length > 50000) return null;
        if (svgText.includes("<script")) return null;

        // SVG → base64 image URI
        const base64 = Buffer.from(svgText.replace(/currentColor/g, '#007ACC')).toString("base64");
        return `data:image/svg+xml;base64,${base64}`;
    }

    //burası düzeltilecek 
    private detectIconPrefix(fullClass: string): string | undefined {
        if (!fullClass) return undefined;

        const classes = fullClass.split(/\s+/).map(c => c.trim()).filter(Boolean);

        //  Font Awesome prefix listesi (FA4–FA7)
        const faPrefixes = ['fa', 'fas', 'far', 'fal', 'fat', 'fad', 'fab'];

        //  Bootstrap Icons
        const bootstrapPrefixes = ['bi'];

        //  BoxIcons (çok kullanılıyor)			
        const boxPrefixes = ['bx', 'bxs', 'bxr'];

        // ✔ Önce FA prefix kontrolü
        for (const c of classes) {
            if (faPrefixes.includes(c)) return c;
        }

        // Bootstrap
        if (classes.includes('bi')) return 'bi';

        //  Boxicons → HER ZAMAN bx
        if (classes.some(c => c === 'bx' || c.startsWith('bx'))) {
            return 'bx';
        }

        // ✔ Yedek: "fa-" ile başlayan bir şey (örn. eski FA4 için)
        const fa4Like = classes.find(c => c.startsWith("fa-"));
        if (fa4Like) return "fa";

        return undefined;
    }



    /**
     * Generate SVG data URI from icon definition using opentype.js
     * Tries sibling classes if the primary doesn't have the glyph
     */
    // private async glyphToSvgDataUri(iconDef: any): Promise<string | null> {
    //     if (!iconDef.cssValue) {
    //         return null;
    //     }
    //     console.log(`Generating SVG for icon: ${iconDef.className}`);
    //     // Get the font for this icon

    //     let font = await FontManager.getFontForIcon(iconDef);
    //     if (!font) {
    //         console.warn(`Could not load font for icon: ${iconDef.className}`);
    //         return null;
    //     }

    //     // Try to generate SVG
    //     let result = FontManager.glyphToSvgDataUri(iconDef.fontUrl, iconDef.cssValue);

    //     // If failed and has sibling classes, try each sibling
    //     if (!result && iconDef.siblingClassNames && iconDef.siblingClassNames.length > 1) {
    //         console.log(`Trying sibling classes for ${iconDef.className}: ${iconDef.siblingClassNames.join(', ')}`);

    //         for (const siblingClassName of iconDef.siblingClassNames) {
    //             if (siblingClassName === iconDef.className) {
    //                 continue; // Already tried this one
    //             }

    //             const siblingIcon = CssScanner.getIcons().find(icon => icon.className === siblingClassName);
    //             if (siblingIcon) {
    //                 const siblingFont = await FontManager.getFontForIcon(siblingIcon);
    //                 if (siblingFont) {
    //                     result = FontManager.glyphToSvgDataUri(siblingFont, iconDef.cssValue);
    //                     if (result) {
    //                         console.log(`Found glyph using sibling class: ${siblingClassName}`);
    //                         break;
    //                     }
    //                 }
    //             }
    //         }
    //     }

    //     return result;
    // }
    private async glyphToSvgDataUri(iconDef: any): Promise<string | null> {
        if (!iconDef.cssValue || !iconDef.fontUrl) {
            return null;
        }
        console.log(`Generating SVG for icon: ${iconDef.className} using font URL: ${iconDef.fontUrl}`);
        try {
            // %92 doğru olan yol → direkt fontUrl
            const font = await FontManager.loadFontFromUrl(iconDef.fontUrl);
            if (!font) {
                return null;
            }

            return FontManager.glyphToSvgDataUri(font, iconDef.cssValue);
        } catch (err) {
            console.error(`Hover SVG generation failed for ${iconDef.className}`, err);
            return null;
        }
    }

    private provideImageHover(document: vscode.TextDocument, imagePath: string): vscode.Hover | null {
        const currentDir = path.dirname(document.fileName);
        let absolutePath = path.resolve(currentDir, imagePath);

        if (!fs.existsSync(absolutePath)) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                absolutePath = path.resolve(workspaceFolder.uri.fsPath, imagePath);
                if (!fs.existsSync(absolutePath) && imagePath.startsWith('/')) {
                    absolutePath = path.resolve(workspaceFolder.uri.fsPath, imagePath.substring(1));
                }
            }
        }

        if (!fs.existsSync(absolutePath)) return null;

        const ext = path.extname(absolutePath).toLowerCase();
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;
        try {
            const stats = fs.statSync(absolutePath);
            const fileSizeKB = (stats.size / 1024).toFixed(1);

            let dimensionText = '';
            if (ext === '.svg') {
                const svgContent = fs.readFileSync(absolutePath, 'utf-8');
                const base64 = Buffer.from(svgContent).toString('base64');

                const widthMatch = svgContent.match(/width=["']?(\d+)/);
                const heightMatch = svgContent.match(/height=["']?(\d+)/);
                if (widthMatch && heightMatch) {
                    dimensionText = `${widthMatch[1]} x ${heightMatch[1]} px`;
                }

                markdown.appendMarkdown(`**Preview (${dimensionText}${dimensionText ? ', ' : ''}${fileSizeKB} KB):**\n\n![${imagePath}](data:image/svg+xml;base64,${base64})`);
            } else {
                const buffer = fs.readFileSync(absolutePath);
                const dimensions = sizeOf(buffer);
                if (dimensions.width && dimensions.height) {
                    dimensionText = `${dimensions.width} x ${dimensions.height} px`;
                }

                markdown.appendMarkdown(`**Preview (${dimensionText}${dimensionText ? ', ' : ''}${fileSizeKB} KB):**\n\n![${imagePath}](${vscode.Uri.file(absolutePath)})`);
            }
        } catch (e) {
            console.warn('Hover preview failed:', e);
            markdown.appendMarkdown(`**Preview:**\n\n![${imagePath}](${vscode.Uri.file(absolutePath)})`);
        }

        return new vscode.Hover(markdown);
    }

    // private provideImageHover(document: vscode.TextDocument, imagePath: string): vscode.Hover | null {
    //     // Resolve path relative to the current document
    //     const currentDir = path.dirname(document.fileName);
    //     let absolutePath = path.resolve(currentDir, imagePath);

    //     // If not found, try workspace root
    //     if (!fs.existsSync(absolutePath)) {
    //         const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    //         if (workspaceFolder) {
    //             absolutePath = path.resolve(workspaceFolder.uri.fsPath, imagePath);
    //             if (!fs.existsSync(absolutePath)) {
    //                 // Try removing leading slash if present
    //                 if (imagePath.startsWith('/')) {
    //                     absolutePath = path.resolve(workspaceFolder.uri.fsPath, imagePath.substring(1));
    //                 }
    //             }
    //         }
    //     }

    //     if (fs.existsSync(absolutePath)) {
    //         const markdown = new vscode.MarkdownString(`**Preview:**\n\n![${imagePath}](${vscode.Uri.file(absolutePath)})`);
    //         markdown.isTrusted = true;
    //         return new vscode.Hover(markdown);
    //     }

    //     return null;
    // }
}
