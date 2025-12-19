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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const image_size_1 = __importDefault(require("image-size"));
const CssScanner_1 = require("../utils/CssScanner");
const FontManager_1 = require("../utils/FontManager");
const IconSenseState_1 = require("../state/IconSenseState");
const library_detectors_1 = require("../utils/library-detectors");
class ImageHoverProvider {
    async provideHover(document, position, token) {
        if (!IconSenseState_1.IconSenseState.ready) {
            return null;
        }
        const range = document.getWordRangeAtPosition(position, /([a-zA-Z0-9\s_\-\.\/]+\.(png|jpg|jpeg|gif|svg|webp))|([a-zA-Z0-9_\-]+)/);
        if (!range) {
            return null;
        }
        const word = document.getText(range);
        if (word.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) {
            return this.provideImageHover(document, word);
        }
        const icons = CssScanner_1.CssScanner.getIcons();
        const matchedIcon = icons.find((i) => i.className === word);
        if (matchedIcon) {
            let markdown = new vscode.MarkdownString(`**Icon:** \`${matchedIcon.className}\``);
            markdown.supportHtml = true;
            markdown.isTrusted = true;
            const line = document.lineAt(position).text;
            let fullClass = matchedIcon.className;
            console.log("matchedIcon", matchedIcon);
            const classMatch = line.match(/class=["']([^"']*)["']/);
            if (classMatch) {
                const classContent = classMatch[1];
                if (classContent.includes(word)) {
                    fullClass = classContent;
                }
            }
            if (matchedIcon.cssValue) {
                try {
                    let iconForPreview = matchedIcon;
                    const expectedFontName = (0, library_detectors_1.detectFontUrlName)(fullClass);
                    let fontUrl = iconForPreview.allFontUrls?.find(u => u.includes(expectedFontName));
                    if (!iconForPreview.cssValue)
                        return null;
                    if (!fontUrl) {
                        fontUrl = await FontManager_1.FontManager.findFontContainingGlyph(parseInt(iconForPreview.cssValue, 16), iconForPreview.allFontUrls || []);
                    }
                    const font = await FontManager_1.FontManager.loadFontFromUrl(fontUrl);
                    if (!font)
                        return null;
                    const svgDataUri = FontManager_1.FontManager.glyphToSvgDataUri(font, iconForPreview.cssValue);
                    if (!iconForPreview.cssValue)
                        return null;
                    const range = this.findITagRange(document, position);
                    const rawSvg = FontManager_1.FontManager.glyphToRawSvg(font, iconForPreview.cssValue);
                    if (svgDataUri) {
                        markdown.appendMarkdown(`\n\n**Preview:**\n\n`);
                        markdown.appendMarkdown(`![](${svgDataUri})\n\n`);
                        const linkHtml = `<a href="command:iconsense.convertToSvg?${encodeURIComponent(JSON.stringify({
                            svg: rawSvg,
                            className: fullClass,
                            range: {
                                start: range?.start,
                                end: range?.end
                            }
                        }))}" title="Click to convert icon to SVG">🛠 Convert to SVG</a>`;
                        markdown.appendMarkdown(linkHtml);
                        if (iconForPreview.detectedFontType) {
                            markdown.appendMarkdown(`\n\n**Detected Type:** \`${iconForPreview.detectedFontType}\``);
                        }
                    }
                    else {
                        markdown.appendMarkdown(`\n\n(Preview generation failed)`);
                    }
                }
                catch (error) {
                    console.error('Error generating icon preview:', error);
                    markdown.appendMarkdown(`\n\n(Preview error)`);
                }
                markdown.appendMarkdown(`\n\n**Unicode:** \`${matchedIcon.cssValue}\``);
                if (matchedIcon.isAlias && matchedIcon.siblingClassNames &&
                    matchedIcon.siblingClassNames.length >= 2) {
                    const aliases = matchedIcon.siblingClassNames
                        .filter(name => name !== matchedIcon.className);
                    if (aliases.length) {
                        markdown.appendMarkdown(`\n\n*Alias of:* ${aliases.map(a => `\`${a}\``).join(', ')}`);
                    }
                }
            }
            else {
                markdown.appendMarkdown(`\n\n(No preview available)`);
            }
            markdown.appendMarkdown(`\n\n**HTML Preview:**\n`);
            let htmlPreviewClass = fullClass;
            if (matchedIcon.detectedFontType) {
                const iconClassName = matchedIcon.className;
                htmlPreviewClass = `${matchedIcon.detectedFontType} ${iconClassName}`;
            }
            markdown.appendCodeblock(`<i class="${htmlPreviewClass}"></i>`, 'html');
            if (matchedIcon.sourceFile && matchedIcon.library?.cssPath) {
                const relPath = vscode.workspace.asRelativePath(matchedIcon.library?.cssPath);
                markdown.appendMarkdown(`\n\nDefined in: \`${relPath}\``);
                const isRemote = /^https?:\/\//i.test(matchedIcon.library?.cssPath);
                if (!isRemote) {
                    const uri = vscode.Uri.file(matchedIcon.library?.cssPath);
                    const linkHtml = `<a href="command:vscode.open?${encodeURIComponent(JSON.stringify(uri))}" title="Open local CSS file in editor">Open CSS</a>`;
                    markdown.appendMarkdown(`\n${linkHtml}`);
                }
                else {
                    const uri = vscode.Uri.parse(matchedIcon.library?.cssPath);
                    const linkHtml = `<a href="command:vscode.openExternal?${encodeURIComponent(JSON.stringify(uri))}" title="Open remote CSS in browser">Open CSS (CDN)</a>`;
                    markdown.appendMarkdown(`\n${linkHtml}`);
                }
            }
            return new vscode.Hover(markdown);
        }
        const svgPreview = this.tryExtractInlineSvg(document, position);
        if (svgPreview) {
            const md = new vscode.MarkdownString();
            md.supportHtml = true;
            md.isTrusted = true;
            md.appendMarkdown(`**SVG Preview:**\n\n`);
            md.appendMarkdown(`![](${svgPreview})`);
            return new vscode.Hover(md);
        }
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
    findITagRange(document, position) {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const tagRegex = /<i\b[^>]*>[\s\S]*?<\/i>/gi;
        let match;
        while ((match = tagRegex.exec(text))) {
            const start = match.index;
            const end = start + match[0].length;
            if (offset >= start && offset <= end) {
                return new vscode.Range(document.positionAt(start), document.positionAt(end));
            }
        }
        return null;
    }
    tryExtractInlineSvg(document, position) {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const start = text.lastIndexOf("<svg", offset);
        if (start === -1)
            return null;
        const end = text.indexOf("</svg>", start);
        if (end === -1)
            return null;
        const svgText = text.substring(start, end + "</svg>".length);
        const svgEnd = end + "</svg>".length;
        if (offset < start || offset > svgEnd) {
            return null;
        }
        if (svgText.length > 50000)
            return null;
        if (svgText.includes("<script"))
            return null;
        const base64 = Buffer.from(svgText.replace(/currentColor/g, '#007ACC')).toString("base64");
        return `data:image/svg+xml;base64,${base64}`;
    }
    detectIconPrefix(fullClass) {
        if (!fullClass)
            return undefined;
        const classes = fullClass.split(/\s+/).map(c => c.trim()).filter(Boolean);
        const faPrefixes = ['fa', 'fas', 'far', 'fal', 'fat', 'fad', 'fab'];
        const bootstrapPrefixes = ['bi'];
        const boxPrefixes = ['bx', 'bxs', 'bxr'];
        for (const c of classes) {
            if (faPrefixes.includes(c))
                return c;
        }
        if (classes.includes('bi'))
            return 'bi';
        if (classes.some(c => c === 'bx' || c.startsWith('bx'))) {
            return 'bx';
        }
        const fa4Like = classes.find(c => c.startsWith("fa-"));
        if (fa4Like)
            return "fa";
        return undefined;
    }
    async glyphToSvgDataUri(iconDef) {
        if (!iconDef.cssValue || !iconDef.fontUrl) {
            return null;
        }
        console.log(`Generating SVG for icon: ${iconDef.className} using font URL: ${iconDef.fontUrl}`);
        try {
            const font = await FontManager_1.FontManager.loadFontFromUrl(iconDef.fontUrl);
            if (!font) {
                return null;
            }
            return FontManager_1.FontManager.glyphToSvgDataUri(font, iconDef.cssValue);
        }
        catch (err) {
            console.error(`Hover SVG generation failed for ${iconDef.className}`, err);
            return null;
        }
    }
    provideImageHover(document, imagePath) {
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
        if (!fs.existsSync(absolutePath))
            return null;
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
            }
            else {
                const buffer = fs.readFileSync(absolutePath);
                const dimensions = (0, image_size_1.default)(buffer);
                if (dimensions.width && dimensions.height) {
                    dimensionText = `${dimensions.width} x ${dimensions.height} px`;
                }
                markdown.appendMarkdown(`**Preview (${dimensionText}${dimensionText ? ', ' : ''}${fileSizeKB} KB):**\n\n![${imagePath}](${vscode.Uri.file(absolutePath)})`);
            }
        }
        catch (e) {
            console.warn('Hover preview failed:', e);
            markdown.appendMarkdown(`**Preview:**\n\n![${imagePath}](${vscode.Uri.file(absolutePath)})`);
        }
        return new vscode.Hover(markdown);
    }
}
exports.ImageHoverProvider = ImageHoverProvider;
//# sourceMappingURL=HoverProvider.js.map