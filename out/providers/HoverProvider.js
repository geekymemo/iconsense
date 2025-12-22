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
const StandaloneScanner_1 = require("../utils/StandaloneScanner");
const config = vscode.workspace.getConfiguration('iconSense');
const allowFetch = config.get('remoteImageInfo', true);
const remoteImageCache = new Map();
class ImageHoverProvider {
    async provideHover(document, position, token) {
        if (!IconSenseState_1.IconSenseState.ready) {
            return null;
        }
        let icons = [];
        if (StandaloneScanner_1.StandaloneScanner.isStandaloneDocument(document.uri)) {
            icons = await StandaloneScanner_1.StandaloneScanner.scanStandaloneDocument(document);
        }
        else {
            icons = CssScanner_1.CssScanner.getIcons();
        }
        const inlineSvg = this.tryExtractInlineSvg(document, position);
        if (inlineSvg) {
            const md = new vscode.MarkdownString();
            md.supportHtml = true;
            md.isTrusted = true;
            md.appendMarkdown(`**SVG Preview:**\n\n`);
            md.appendMarkdown(`![](${inlineSvg})`);
            return new vscode.Hover(md);
        }
        const imageAttrRegex = /(src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{([^}]+)\})/gi;
        const line = document.lineAt(position).text;
        let match;
        while ((match = imageAttrRegex.exec(line))) {
            const rawPath = match[2] || match[3];
            const imagePath = this.normalizeImagePath(rawPath);
            if (!rawPath)
                continue;
            if (!rawPath.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i))
                continue;
            const start = match.index;
            const end = start + match[0].length;
            const range = new vscode.Range(position.line, start, position.line, end);
            if (range.contains(position)) {
                return await this.provideImageHover(document, rawPath);
            }
        }
        const rangeimg = document.getWordRangeAtPosition(position, /[^\s"'<>]+\.(png|jpg|jpeg|gif|svg|webp)/i);
        if (rangeimg) {
            const word = document.getText(rangeimg);
            return await this.provideImageHover(document, word);
        }
        const iconRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_\-:]+/);
        if (!iconRange)
            return null;
        const word = document.getText(iconRange);
        const matchedIcon = icons.find((i) => i.className === word);
        if (matchedIcon) {
            let markdown = new vscode.MarkdownString(`**Icon:** \`${matchedIcon.className}\``);
            markdown.supportHtml = true;
            markdown.isTrusted = true;
            const line = document.lineAt(position).text;
            let fullClass = matchedIcon.className;
            console.log('matchedIcon', matchedIcon);
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
                    let fontUrl = iconForPreview.allFontUrls?.find((u) => u.includes(expectedFontName));
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
                                end: range?.end,
                            },
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
                if (matchedIcon.isAlias && matchedIcon.siblingClassNames && matchedIcon.siblingClassNames.length >= 2) {
                    const aliases = matchedIcon.siblingClassNames.filter((name) => name !== matchedIcon.className);
                    if (aliases.length) {
                        markdown.appendMarkdown(`\n\n*Alias of:* ${aliases.map((a) => `\`${a}\``).join(', ')}`);
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
        const start = text.lastIndexOf('<svg', offset);
        if (start === -1)
            return null;
        const end = text.indexOf('</svg>', start);
        if (end === -1)
            return null;
        const svgText = text.substring(start, end + '</svg>'.length);
        const svgEnd = end + '</svg>'.length;
        if (offset < start || offset > svgEnd) {
            return null;
        }
        if (svgText.length > 50000)
            return null;
        if (svgText.includes('<script'))
            return null;
        const base64 = Buffer.from(svgText.replace(/currentColor/g, '#007ACC')).toString('base64');
        return `data:image/svg+xml;base64,${base64}`;
    }
    async provideImageHover(document, imagePath) {
        if (/^https?:\/\//i.test(imagePath)) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.supportHtml = true;
            markdown.appendMarkdown(`**Preview:**\n\n![img](${imagePath})`);
            if (allowFetch) {
                console.log('Fetching remote image info for hover:', imagePath);
                const info = await this.fetchRemoteImageInfo(imagePath);
                if (info) {
                    markdown.appendMarkdown(`\n\n**Resolution:** ${info.width} × ${info.height}px` + `, **Size:** ${info.sizeKB} KB`);
                }
            }
            return new vscode.Hover(markdown);
        }
        function resolveFrameworkAliases(imagePath, rootPath) {
            const candidates = [];
            if (imagePath.startsWith('@/')) {
                candidates.push(path.join(rootPath, imagePath.substring(2)));
            }
            if (imagePath.startsWith('~/')) {
                candidates.push(path.join(rootPath, imagePath.substring(2)));
            }
            candidates.push(path.join(rootPath, 'assets', imagePath.replace(/^\/+/, '')));
            candidates.push(path.join(rootPath, 'public', imagePath.replace(/^\/+/, '')));
            candidates.push(path.join(rootPath, 'static', imagePath.replace(/^\/+/, '')));
            return candidates;
        }
        const currentDir = path.dirname(document.fileName);
        let absolutePath = null;
        const relativePath = path.resolve(currentDir, imagePath);
        if (fs.existsSync(relativePath)) {
            absolutePath = relativePath;
        }
        if (!absolutePath) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                const rootPath = workspaceFolder.uri.fsPath;
                const rootRelative = path.resolve(rootPath, imagePath);
                if (fs.existsSync(rootRelative)) {
                    absolutePath = rootRelative;
                }
                if (!absolutePath && imagePath.startsWith('/')) {
                    const stripped = imagePath.substring(1);
                    const rootAbsolute = path.resolve(rootPath, stripped);
                    if (fs.existsSync(rootAbsolute)) {
                        absolutePath = rootAbsolute;
                    }
                }
                if (!absolutePath) {
                    const candidates = resolveFrameworkAliases(imagePath, rootPath);
                    for (const p of candidates) {
                        if (fs.existsSync(p)) {
                            absolutePath = p;
                            break;
                        }
                    }
                }
            }
        }
        if (!absolutePath)
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
                markdown.appendMarkdown(`**Preview (${dimensionText}${dimensionText ? ', ' : ''}${fileSizeKB} KB):**\n\n` +
                    `![${imagePath}](${vscode.Uri.file(absolutePath)})`);
            }
            else {
                const buffer = fs.readFileSync(absolutePath);
                const dimensions = (0, image_size_1.default)(buffer);
                if (dimensions.width && dimensions.height) {
                    dimensionText = `${dimensions.width} x ${dimensions.height} px`;
                }
                markdown.appendMarkdown(`**Preview (${dimensionText}${dimensionText ? ', ' : ''}${fileSizeKB} KB):**\n\n` +
                    `![${imagePath}](${vscode.Uri.file(absolutePath)})`);
            }
        }
        catch (e) {
            console.warn('Hover preview failed:', e);
            markdown.appendMarkdown(`**Preview:**\n\n![${imagePath}](${vscode.Uri.file(absolutePath)})`);
        }
        return new vscode.Hover(markdown);
    }
    normalizeImagePath(raw) {
        let p = raw.trim();
        p = p.replace(/^[`'"]|[`'"]$/g, '');
        if (p.includes('${'))
            return null;
        const requireMatch = p.match(/require\(['"](.+?)['"]\)/);
        if (requireMatch)
            return requireMatch[1];
        return p;
    }
    async fetchRemoteImageInfo(url) {
        if (remoteImageCache.has(url)) {
            return remoteImageCache.get(url);
        }
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(url, {
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok)
                return null;
            const buffer = Buffer.from(await res.arrayBuffer());
            const dimensions = (0, image_size_1.default)(buffer);
            if (!dimensions.width || !dimensions.height)
                return null;
            const info = {
                width: dimensions.width,
                height: dimensions.height,
                sizeKB: +(buffer.length / 1024).toFixed(1),
            };
            remoteImageCache.set(url, info);
            return info;
        }
        catch {
            return null;
        }
    }
}
exports.ImageHoverProvider = ImageHoverProvider;
//# sourceMappingURL=HoverProvider.js.map