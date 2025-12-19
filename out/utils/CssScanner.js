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
exports.CssScanner = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const url_1 = require("url");
const FontManager_1 = require("./FontManager");
const library_detectors_1 = require("./library-detectors");
const treeShaking_1 = require("../treeShaking/treeShaking");
const CssVersion_1 = require("../utils/CssVersion");
const CssFetch_1 = require("./CssFetch");
const IconPrefix_1 = require("../utils/IconPrefix");
const CommentRanges_1 = require("../utils/CommentRanges");
const config = vscode.workspace.getConfiguration('iconSense');
const autoScanCss = config.get('autoScanCss', true);
const scanHtml = config.get('scanHtml', true);
const scanCss = config.get('scanCss', true);
const scanJsTs = config.get('scanJsTs', true);
const scanPhp = config.get('scanPhp', false);
const vueEnabled = config.get('framework.vue', true);
const nuxtEnabled = config.get('framework.nuxt', true);
const reactEnabled = config.get('framework.react', true);
const nextEnabled = config.get('framework.next', true);
class CssScanner {
    static async processInBatches(items, batchSize, iterator) {
        let results = [];
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(iterator));
            results.push(...batchResults);
        }
        return results;
    }
    static async scanWorkspace(diagnostics, force) {
        if (this.isScanning) {
            return this.cache ?? [];
        }
        this.isScanning = true;
        let allIcons = [];
        const cacheKey = 'allIcons';
        treeShaking_1.TreeShaker.clearCache?.();
        CssScanner.clearCache();
        if (this.iconCache.has(cacheKey)) {
            this.isScanning = false;
            return this.iconCache.get(cacheKey);
        }
        if (autoScanCss && scanCss) {
            const cssFiles = await vscode.workspace.findFiles('**/*.{css}', '**/node_modules/**');
            const cssResults = await this.processInBatches(cssFiles, 50, async (file) => {
                return this.parseCssFile(file.fsPath);
            });
            cssResults.forEach(icons => allIcons.push(...icons));
        }
        if (scanHtml) {
            const htmlFiles = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**');
            const remoteUrls = await this.findRemoteCssUrls(htmlFiles);
            for (const url of remoteUrls) {
                try {
                    if (url.startsWith('http')) {
                        const css = await (0, CssFetch_1.fetchUrlCached)(url);
                        allIcons.push(...await this.extractIcons(css, url));
                    }
                    else {
                        const resolved = this.resolveWorkspaceCss(url);
                        if (resolved) {
                            allIcons.push(...await this.parseCssFile(resolved));
                        }
                    }
                }
                catch (err) {
                    console.error(`Failed to fetch ${url}`, err);
                }
            }
        }
        if (nuxtEnabled) {
            const nuxtConfigs = await vscode.workspace.findFiles('**/nuxt.config.{js,ts,mjs}', '**/node_modules/**');
            for (const cfg of nuxtConfigs) {
                try {
                    const content = await fs.promises.readFile(cfg.fsPath, 'utf-8');
                    const cssUrls = this.extractCssFromNuxtConfig(content);
                    for (const url of cssUrls) {
                        if (url.startsWith('http')) {
                            const css = await (0, CssFetch_1.fetchUrlCached)(url);
                            allIcons.push(...await this.extractIcons(css, url));
                        }
                        else {
                            const resolved = this.resolveWorkspaceCss(url);
                            if (resolved) {
                                allIcons.push(...await this.parseCssFile(resolved));
                            }
                        }
                    }
                }
                catch (e) {
                    console.warn('Failed to parse nuxt config:', cfg.fsPath, e);
                }
            }
        }
        if (nextEnabled) {
            await this.scanNextJsGlobals(allIcons);
        }
        if (reactEnabled) {
            await this.scanReactEntry(allIcons);
        }
        if (scanJsTs || scanHtml || scanPhp) {
            await this.scanFrameworkUsages(allIcons, {
                vue: vueEnabled,
                nuxt: nuxtEnabled,
                react: reactEnabled,
                next: nextEnabled,
                scanPhp,
                scanJsTs,
                scanHtml
            });
        }
        if (!autoScanCss && (reactEnabled || nextEnabled || vueEnabled || nuxtEnabled)) {
            await this.scanCssImportsFromCode(allIcons);
        }
        treeShaking_1.TreeShaker.treeShakingReports = treeShaking_1.TreeShaker.detectTreeShaking(allIcons, this.usedIconClasses);
        treeShaking_1.TreeShaker.showTreeShakingNotifications(treeShaking_1.TreeShaker.treeShakingReports, force);
        this.cache = allIcons;
        this.iconCache.set(cacheKey, allIcons);
        this.isScanning = false;
        return allIcons;
    }
    static async scanCssImportsFromCode(allIcons) {
        const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,vue}', '**/node_modules/**');
        const CSS_IMPORT_REGEX = /import\s+['"]([^'"]+\.css)['"]|require\(\s*['"]([^'"]+\.css)['"]\s*\)/g;
        for (const file of files) {
            const content = (await vscode.workspace.fs.readFile(file)).toString();
            const commentRanges = await (0, CommentRanges_1.getCommentRanges)(content);
            let match;
            while ((match = CSS_IMPORT_REGEX.exec(content)) !== null) {
                if ((0, CommentRanges_1.isInsideComment)(match.index, commentRanges)) {
                    continue;
                }
                const cssPath = match[1] || match[2];
                const resolved = this.resolveWorkspaceCss(cssPath, file.fsPath);
                if (resolved) {
                    allIcons.push(...await this.parseCssFile(resolved));
                }
            }
        }
    }
    static resolveWorkspaceCss(cssPath, importer) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders)
            return null;
        for (const folder of workspaceFolders) {
            const root = folder.uri.fsPath;
            if (cssPath.startsWith('~/') || cssPath.startsWith('@/')) {
                const resolved = path.join(root, cssPath.replace(/^~\/|^@\//, ''));
                if (fs.existsSync(resolved))
                    return resolved;
            }
            if ((cssPath.startsWith('./') || cssPath.startsWith('../')) && importer) {
                const baseDir = path.dirname(importer);
                const resolved = path.resolve(baseDir, cssPath);
                if (fs.existsSync(resolved))
                    return resolved;
            }
            const nodeModulePath = path.join(root, 'node_modules', cssPath);
            if (fs.existsSync(nodeModulePath))
                return nodeModulePath;
            const direct = path.join(root, cssPath);
            if (fs.existsSync(direct))
                return direct;
        }
        return null;
    }
    static extractCssFromNuxtConfig(content) {
        const urls = [];
        const cssArrayRegex = /css\s*:\s*\[([\s\S]*?)\]/g;
        const stringRegex = /['"`]([^'"`]+\.css)['"`]/g;
        let m;
        while ((m = cssArrayRegex.exec(content)) !== null) {
            let sm;
            while ((sm = stringRegex.exec(m[1])) !== null) {
                urls.push(sm[1]);
            }
        }
        const hrefRegex = /href\s*:\s*['"`](https?:\/\/[^'"`]+\.css)['"`]/g;
        while ((m = hrefRegex.exec(content)) !== null) {
            urls.push(m[1]);
        }
        return urls;
    }
    static async scanNextJsGlobals(allIcons) {
        const entryFiles = await vscode.workspace.findFiles('{app/layout.tsx,pages/_app.tsx}', '**/node_modules/**');
        for (const file of entryFiles) {
            const content = await fs.promises.readFile(file.fsPath, 'utf-8');
            const commentRanges = await (0, CommentRanges_1.getCommentRanges)(content);
            const IMPORT_CSS_REGEX = /import\s+['"]([^'"]+\.css)['"]/g;
            let match;
            while ((match = IMPORT_CSS_REGEX.exec(content)) !== null) {
                if ((0, CommentRanges_1.isInsideComment)(match.index, commentRanges)) {
                    continue;
                }
                const cssPath = match[1];
                if (cssPath.startsWith('http')) {
                    const css = await (0, CssFetch_1.fetchUrl)(cssPath);
                    allIcons.push(...await this.extractIcons(css, cssPath));
                }
                else {
                    const resolved = this.resolveWorkspaceCss(cssPath, file.fsPath);
                    if (resolved) {
                        allIcons.push(...await this.parseCssFile(resolved));
                    }
                }
            }
        }
    }
    static async scanFrameworkUsages(allIcons, options) {
        this.usedIconClasses.clear();
        const globs = [];
        if (options.scanJsTs)
            globs.push('js', 'jsx', 'ts', 'tsx');
        if (options.vue || options.nuxt)
            globs.push('vue');
        if (options.scanHtml)
            globs.push('html');
        if (options.scanPhp)
            globs.push('php');
        if (!globs.length)
            return;
        const files = await vscode.workspace.findFiles(`**/*.{${globs.join(',')}}`, '**/node_modules/**');
        const iconMap = new Map();
        for (const icon of allIcons) {
            iconMap.set(icon.className, icon);
        }
        const CLASS_REGEX = /(class|className)\s*=\s*(["'`])([^"'`]+)\2/g;
        await this.processInBatches(files, 50, async (file) => {
            const content = (await vscode.workspace.fs.readFile(file)).toString();
            const commentRanges = await (0, CommentRanges_1.getCommentRanges)(content);
            const templateMatch = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(content);
            const scanContent = templateMatch?.[1] ?? content;
            let match;
            while ((match = CLASS_REGEX.exec(scanContent)) !== null) {
                if ((0, CommentRanges_1.isInsideComment)(match.index, commentRanges)) {
                    continue;
                }
                const classes = match[3].split(/\s+/);
                for (const cls of classes) {
                    const icon = iconMap.get(cls);
                    if (icon) {
                        this.usedIconClasses.add(icon.className);
                    }
                }
            }
        });
    }
    static async scanReactEntry(allIcons) {
        const entryFiles = await vscode.workspace.findFiles('{src/index.tsx,src/index.jsx,src/main.tsx,src/main.jsx}', '**/node_modules/**');
        for (const file of entryFiles) {
            const content = await fs.promises.readFile(file.fsPath, 'utf-8');
            const commentRanges = await (0, CommentRanges_1.getCommentRanges)(content);
            const IMPORT_CSS_REGEX = /import\s+['"]([^'"]+\.css)['"]/g;
            let match;
            while ((match = IMPORT_CSS_REGEX.exec(content)) !== null) {
                if ((0, CommentRanges_1.isInsideComment)(match.index, commentRanges)) {
                    continue;
                }
                const cssPath = match[1];
                if (cssPath.startsWith('http')) {
                    const css = await (0, CssFetch_1.fetchUrl)(cssPath);
                    allIcons.push(...await this.extractIcons(css, cssPath));
                }
                else {
                    const resolved = this.resolveWorkspaceCss(cssPath, file.fsPath);
                    if (resolved) {
                        allIcons.push(...await this.parseCssFile(resolved));
                    }
                }
            }
        }
    }
    static async findRemoteCssUrls(htmlFiles) {
        const urls = new Set();
        const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
        await this.processInBatches(htmlFiles, 50, async (file) => {
            try {
                const uint8Array = await vscode.workspace.fs.readFile(file);
                let content = new TextDecoder().decode(uint8Array);
                const commentRanges = await (0, CommentRanges_1.getCommentRanges)(content);
                let match;
                while ((match = linkRegex.exec(content)) !== null) {
                    if ((0, CommentRanges_1.isInsideComment)(match.index, commentRanges)) {
                        continue;
                    }
                    urls.add(match[1]);
                }
            }
            catch (e) {
                console.error(`Error reading HTML file ${file.fsPath}`, e);
            }
        });
        return urls;
    }
    static async parseCssFile(filePath) {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            if (!this.isLikelyIconFont(content))
                return [];
            return this.extractIcons(content, filePath);
        }
        catch (error) {
            console.error(`Error parsing CSS file ${filePath}:`, error);
            return [];
        }
    }
    static extractFontFaces(content, baseUrl) {
        const normalizeFontUrl = (url) => url.split(/[?#]/)[0];
        const fontMap = new Map();
        const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
        let match;
        while ((match = fontFaceRegex.exec(content)) !== null) {
            const ruleBody = match[1];
            let familyMatch = /font-family\s*:\s*["']([^"']+)["']/i.exec(ruleBody);
            if (!familyMatch) {
                familyMatch = /font-family\s*:\s*([^;!]+)/i.exec(ruleBody);
            }
            if (!familyMatch)
                continue;
            const fontFamily = familyMatch[1].trim();
            const urlRegex = /url\(["']?([^"')]+?\.(woff2?|woff|ttf|otf)[^"')]*?)["']?\)/gi;
            let urlMatch;
            while ((urlMatch = urlRegex.exec(ruleBody)) !== null) {
                let fontUrl = normalizeFontUrl(urlMatch[1]);
                if (fontUrl.endsWith('.eot'))
                    continue;
                if (!fontUrl.startsWith('http://') &&
                    !fontUrl.startsWith('https://')) {
                    if (baseUrl.startsWith('http')) {
                        const cssBaseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
                        fontUrl = new URL(fontUrl, cssBaseUrl).href;
                    }
                    else {
                        const cssDir = path.dirname(baseUrl);
                        const absolutePath = path.resolve(cssDir, fontUrl);
                        fontUrl = (0, url_1.pathToFileURL)(absolutePath).href;
                    }
                }
                if (!fontMap.has(fontFamily)) {
                    fontMap.set(fontFamily, []);
                }
                fontMap.get(fontFamily).push(fontUrl);
            }
        }
        return fontMap;
    }
    static resolveFontUrls(isBoxicon, iconFontUrls) {
        if (isBoxicon && CssScanner.boxiconsFontUrls.length) {
            return CssScanner.boxiconsFontUrls;
        }
        return iconFontUrls;
    }
    static async extractIcons(content, sourceName) {
        const icons = [];
        const uniqueParams = new Set();
        const commentRanges = await (0, CommentRanges_1.getCommentRanges)(content);
        const fontMap = this.extractFontFaces(content, sourceName);
        const iconFontUrls = [];
        for (const [family, urls] of fontMap.entries()) {
            if (family.toLowerCase().includes('font awesome') ||
                family.toLowerCase().includes('bootstrap') ||
                family.toLowerCase().includes('icon')) {
                for (const url of urls) {
                    if (!iconFontUrls.includes(url)) {
                        iconFontUrls.push(url);
                    }
                }
            }
        }
        if (iconFontUrls.length === 0 && fontMap.size > 0) {
            const allUrls = Array.from(fontMap.values()).flat();
            for (const url of allUrls) {
                if (!iconFontUrls.includes(url)) {
                    iconFontUrls.push(url);
                }
            }
        }
        iconFontUrls.sort((a, b) => {
            const aScore = a.includes('solid') ? 0 : a.includes('regular') ? 1 : a.includes('brands') ? 2 : 3;
            const bScore = b.includes('solid') ? 0 : b.includes('regular') ? 1 : b.includes('brands') ? 2 : 3;
            return aScore - bScore;
        });
        const ruleRegex = /([^{]+)\{([^}]+)\}/g;
        let match;
        while ((match = ruleRegex.exec(content)) !== null) {
            if ((0, CommentRanges_1.isInsideComment)(match.index, commentRanges)) {
                continue;
            }
            const selector = match[1];
            const body = match[2];
            if (!/content\s*:|--fa\s*:/.test(body))
                continue;
            if (/^\s*:/.test(selector))
                continue;
            const contentValueMatch = /(?:content|--fa)\s*:\s*(?:["']\\?([a-fA-F0-9]+)["']|\\?([a-fA-F0-9]+))/i.exec(body);
            const cssValue = contentValueMatch ? (contentValueMatch[1] || contentValueMatch[2]) : undefined;
            if (!cssValue)
                continue;
            const classRegex = /\.([a-zA-Z0-9_\-]+)/g;
            const classesInSelector = [];
            let classMatch;
            while ((classMatch = classRegex.exec(selector)) !== null) {
                const fullClass = classMatch[1];
                let inferredPrefix;
                if (/^(bxs|bxl|bx)-/i.test(fullClass)) {
                    inferredPrefix = (0, IconPrefix_1.detectBoxiconsFontType)(fullClass, sourceName);
                }
                else if (/^(fas|far|fal|fad|fab|fa)-/i.test(fullClass)) {
                    inferredPrefix = fullClass.split('-', 1)[0].toLowerCase();
                }
                else {
                    inferredPrefix = (0, IconPrefix_1.detectIconPrefix)(fullClass);
                }
                const prefixMatch = /^(fas|far|fal|fad|fab)$/i.exec(fullClass);
                if (prefixMatch)
                    continue;
                const prevIndex = classRegex.lastIndex - fullClass.length - 1;
                const prevText = selector.substring(0, prevIndex).trim();
                let prefix;
                const prevPrefixMatch = /(fas|far|fal|fad|fab|fa|bi)/i.exec(prevText);
                if (prevPrefixMatch) {
                    prefix = prevPrefixMatch[1].toLowerCase();
                }
                let detectedPrefix;
                if (sourceName.toLowerCase().includes('boxicons')) {
                    detectedPrefix = (0, IconPrefix_1.detectBoxiconsFontType)(sourceName);
                }
                if (!detectedPrefix) {
                    detectedPrefix = inferredPrefix || prefix || (0, IconPrefix_1.detectIconPrefix)(fullClass);
                }
                classesInSelector.push({
                    className: fullClass,
                    prefix: detectedPrefix
                });
                console.log('prefix:', detectedPrefix);
            }
            for (const { className, prefix } of classesInSelector) {
                const isBoxicon = prefix === 'bx' || prefix === 'bxs' || prefix === 'bxl';
                const allUrls = CssScanner.resolveFontUrls(isBoxicon, iconFontUrls);
                if (!allUrls.length) {
                    console.warn('NO FONT URL FOR ICON:', className, prefix);
                    continue;
                }
                const library = this.resolveLibrary(content, sourceName);
                if (library) {
                    if (library?.id === 'bootstrap-icons') {
                        if (!prefix && !className.startsWith('bi-'))
                            continue;
                        if (prefix && prefix !== 'bi')
                            continue;
                    }
                    if (library?.id === 'boxicons') {
                        if (!prefix)
                            continue;
                        if (prefix && !['bx', 'bxl', 'bxs'].includes(prefix)) {
                            continue;
                        }
                    }
                    const exists = treeShaking_1.TreeShaker.detectedLibraries.some(l => l.id === library.id &&
                        l.version === library.version &&
                        l.cssPath === library.cssPath);
                    if (!exists) {
                        treeShaking_1.TreeShaker.detectedLibraries.push({
                            id: library.id,
                            version: library.version ?? 'unknown',
                            cssPath: library.cssPath
                        });
                    }
                }
                const matchedFontUrl = await FontManager_1.FontManager.findFontContainingGlyph(parseInt(cssValue, 16), allUrls);
                const fontFamily = matchedFontUrl ? FontManager_1.FontManager.getFontFamilyName(matchedFontUrl) : undefined;
                const uniqueKey = `${prefix ?? 'fa'}| ${matchedFontUrl}|${fontFamily} |${className}`;
                if (!uniqueParams.has(uniqueKey)) {
                    uniqueParams.add(uniqueKey);
                    icons.push({
                        className,
                        prefix: prefix,
                        cssValue,
                        sourceFile: sourceName,
                        fontUrl: matchedFontUrl,
                        allFontUrls: allUrls,
                        fontFamily,
                        isAlias: false,
                        detectedFontType: prefix ? [prefix] : undefined,
                        library
                    });
                }
            }
        }
        const unicodeGroups = new Map();
        for (const icon of icons) {
            if (icon.cssValue) {
                if (!unicodeGroups.has(icon.cssValue))
                    unicodeGroups.set(icon.cssValue, []);
                unicodeGroups.get(icon.cssValue).push(icon);
            }
        }
        const unicodeEntries = Array.from(unicodeGroups.entries());
        let uIndex = 0;
        const CONCURRENCY_UNICODES = 10;
        function isFontAwesomeGroup(group) {
            return group.some(icon => {
                const p = icon.prefix;
                if (!p)
                    return false;
                const prefixes = Array.isArray(p) ? p : [p];
                return prefixes.some(px => px.startsWith('fa'));
            });
        }
        async function unicodeWorker() {
            while (true) {
                const ui = uIndex++;
                if (ui >= unicodeEntries.length)
                    return;
                const [unicode, group] = unicodeEntries[ui];
                const candidateUrls = Array.from(new Set(group.flatMap(g => g.allFontUrls || [])));
                if (group[0]?.library?.id === 'boxicons') {
                    for (const icon of group) {
                        icon.detectedFontType = [
                            (0, IconPrefix_1.detectBoxiconsFontType)(icon.library?.cssPath ||
                                icon.sourceFile ||
                                icon.fontUrl ||
                                '')
                        ];
                    }
                    continue;
                }
                try {
                    const isFontAwesome = isFontAwesomeGroup(group);
                    const foundFontUrls = isFontAwesome
                        ? await CssScanner.detectFontUrlsForUnicode(unicode, candidateUrls)
                        : await CssScanner.detectFontUrlsForUnicodeCached(unicode, candidateUrls);
                    const detectedTypes = foundFontUrls.length
                        ? Array.from(new Set(foundFontUrls.map(url => (0, library_detectors_1.detectFontTypeForUnic)(url))))
                        : null;
                    for (const icon of group) {
                        if (!detectedTypes) {
                            const heur = (0, library_detectors_1.detectFontTypeForUnic)(icon.fontUrl || icon.allFontUrls?.[0] || '');
                            icon.detectedFontType = [heur];
                        }
                        else {
                            icon.detectedFontType = detectedTypes;
                        }
                        if (foundFontUrls.length) {
                            icon.allFontUrls = foundFontUrls;
                            icon.fontUrl = foundFontUrls[0];
                        }
                    }
                }
                catch {
                    for (const icon of group) {
                        const heur = (0, library_detectors_1.detectFontTypeForUnic)(icon.fontUrl || icon.allFontUrls?.[0] || '');
                        icon.detectedFontType = [heur];
                    }
                }
            }
        }
        const workers = [];
        for (let i = 0; i < CONCURRENCY_UNICODES; i++)
            workers.push(unicodeWorker());
        await Promise.all(workers);
        for (const [unicode, group] of unicodeGroups.entries()) {
            const classNames = group.map(icon => icon.className);
            this.unicodeToClassesMap.set(unicode, classNames);
            for (const icon of group) {
                icon.siblingClassNames = classNames;
                icon.isAlias = classNames.length > 1;
            }
        }
        return icons;
    }
    static async detectFontUrlsForUnicode(unicodeHex, fontUrls) {
        if (!fontUrls || fontUrls.length === 0)
            return [];
        const charCode = parseInt(unicodeHex, 16);
        if (!charCode)
            return [];
        const char = String.fromCharCode(charCode);
        const found = [];
        for (let url of fontUrls) {
            try {
                url = url.split('?')[0];
                if (url.endsWith('.eot'))
                    continue;
                const font = await FontManager_1.FontManager.loadFontFromUrl(url);
                if (!font)
                    continue;
                const glyph = font.charToGlyph(char);
                if (glyph && glyph.index !== 0 && glyph.name !== '.notdef') {
                    found.push(url);
                    continue;
                }
                for (let gi = 0; gi < font.glyphs.length; gi++) {
                    const g = font.glyphs.get(gi);
                    if (g.unicodes && g.unicodes.includes(charCode)) {
                        found.push(url);
                        break;
                    }
                }
            }
            catch (err) {
                console.warn("Font test failed:", url, err);
            }
        }
        return found;
    }
    static async detectFontUrlsForUnicodeCached(unicodeHex, fontUrls) {
        const results = [];
        const charCode = parseInt(unicodeHex, 16);
        if (!charCode)
            return results;
        for (const url of fontUrls) {
            if (!this.remoteFontCache.has(url))
                this.remoteFontCache.set(url, new Set());
            const cachedSet = this.remoteFontCache.get(url);
            if (cachedSet.has(unicodeHex)) {
                results.push(url);
                continue;
            }
            try {
                const font = await FontManager_1.FontManager.loadFontFromUrl(url);
                if (!font)
                    continue;
                const char = String.fromCharCode(charCode);
                const glyph = font.charToGlyph(char);
                if (glyph && glyph.index !== 0 && glyph.name !== '.notdef') {
                    cachedSet.add(unicodeHex);
                    results.push(url);
                }
            }
            catch (e) {
                console.warn("Font check failed:", url, e);
            }
        }
        return results;
    }
    static isLikelyIconFont(css) {
        return (/@font-face/i.test(css) &&
            (/font-awesome|font awesome/i.test(css) ||
                /--fa-/i.test(css) ||
                /fa-[a-z]+-\d{3}/i.test(css) ||
                /bootstrap-icons/i.test(css) ||
                /boxicons/i.test(css)));
    }
    static resolveLibrary(cssContent, filePath) {
        if (this.libraryCache.has(filePath)) {
            return this.libraryCache.get(filePath);
        }
        for (const detector of library_detectors_1.LIBRARY_DETECTORS) {
            if (detector.match(cssContent, filePath)) {
                const lib = detector.extract(cssContent, filePath);
                this.libraryCache.set(filePath, lib);
                return lib;
            }
        }
        if (this.isLikelyIconFont(cssContent)) {
            const v = (0, CssVersion_1.resolveVersion)(cssContent, filePath);
            return {
                id: 'unknown',
                shortName: '?',
                displayName: 'Unknown Icon Font',
                version: v.version,
                cssPath: filePath,
                confidence: 'low'
            };
        }
        this.libraryCache.set(filePath, undefined);
        return undefined;
    }
    static getIcons() {
        return this.cache;
    }
    static getAliasMap() {
        return this.aliasMap;
    }
    static getPrimaryClassName(className) {
        return this.aliasMap.get(className) || className;
    }
    static clearCache() {
        this.cache = [];
        this.iconCache.clear();
        this.aliasMap.clear();
        this.unicodeToClassesMap.clear();
        this.usedIconClasses.clear();
        this.libraryCache.clear();
        console.log('CssScanner cache cleared');
    }
}
exports.CssScanner = CssScanner;
CssScanner.cache = [];
CssScanner.aliasMap = new Map();
CssScanner.unicodeToClassesMap = new Map();
CssScanner.iconCache = new Map();
CssScanner.usedIconClasses = new Set();
CssScanner.isScanning = false;
CssScanner.boxiconsFontUrls = [];
CssScanner.remoteFontCache = new Map();
CssScanner.libraryCache = new Map();
//# sourceMappingURL=CssScanner.js.map