// CssScanner.ts (FA7 uyumlu)
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { FontManager } from './FontManager';

import type { IconLibraryInfo } from '../types/css';
import { LIBRARY_DETECTORS, detectFontTypeForUnic } from './library-detectors';
import { IconDefinition } from '../types/icons';
import { TreeShaker } from '../treeShaking/treeShaking';
import { resolveVersion } from '../utils/CssVersion';
import { fetchUrl, fetchUrlCached } from './CssFetch';
import { detectIconPrefix, detectBoxiconsFontType } from '../utils/IconPrefix';
import { getCommentRanges, isInsideComment } from '../utils/CommentRanges';

//Auto scan CSS mode ('auto' : 'html-only')
const config = vscode.workspace.getConfiguration('iconSense');
const autoScanCss = config.get<boolean>('autoScanCss', true);

const scanHtml = config.get<boolean>('scanHtml', true);
const scanCss = config.get<boolean>('scanCss', true);
const scanJsTs = config.get<boolean>('scanJsTs', true);
const scanPhp = config.get<boolean>('scanPhp', false);

const vueEnabled = config.get<boolean>('framework.vue', true);
const nuxtEnabled = config.get<boolean>('framework.nuxt', true);
const reactEnabled = config.get<boolean>('framework.react', true);
const nextEnabled = config.get<boolean>('framework.next', true);

export class CssScanner {
    //icon cahaceleri
    private static cache: IconDefinition[] = [];

    //alias map
    private static aliasMap: Map<string, string> = new Map();

    //unicode map
    private static unicodeToClassesMap: Map<string, string[]> = new Map();

    //
    private static iconCache: Map<string, IconDefinition[]> = new Map();

    //Batches
    private static async processInBatches<T, R>(
        items: T[],
        batchSize: number,
        iterator: (item: T) => Promise<R>
    ): Promise<R[]> {
        let results: R[] = [];
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(iterator));
            results.push(...batchResults);
        }
        return results;
    }

    //Workspace
    private static usedIconClasses: Set<string> = new Set();
    private static isScanning: boolean = false;
    public static async scanWorkspace(
        diagnostics: vscode.DiagnosticCollection,
        force: boolean | true
    ): Promise<IconDefinition[]> {
        if (this.isScanning) {
            return this.cache ?? [];
        }
        this.isScanning = true;
        let allIcons: IconDefinition[] = [];

        const cacheKey = 'allIcons';
        TreeShaker.clearCache?.();
        CssScanner.clearCache();
        if (this.iconCache.has(cacheKey)) {
            this.isScanning = false;
            return this.iconCache.get(cacheKey)!;
        }

        // 1 Local CSS tarama (workspace içi)
        if (autoScanCss && scanCss) {
            const cssFiles = await vscode.workspace.findFiles(
                '**/*.{css}',
                '**/node_modules/**'
            );
            const cssResults = await this.processInBatches(cssFiles, 50, async (file) => {
                return this.parseCssFile(file.fsPath);
            });
            cssResults.forEach((icons) => allIcons.push(...icons));
        }

        // 2 HTML içindeki remote CSS linkleri
        if (scanHtml) {
            const htmlFiles = await vscode.workspace.findFiles(
                '**/*.html',
                '**/node_modules/**'
            );
            const remoteUrls = await this.findRemoteCssUrls(htmlFiles);
            for (const url of remoteUrls) {
                try {
                    if (url.startsWith('http')) {
                        const css = await fetchUrlCached(url);
                        allIcons.push(...(await this.extractIcons(css, url)));
                    } else {
                        const resolved = this.resolveWorkspaceCss(url);
                        if (resolved) {
                            allIcons.push(...(await this.parseCssFile(resolved)));
                        }
                    }
                } catch (err) {
                    console.error(`Failed to fetch ${url}`, err);
                }
            }
        }

        // 3 Nuxt config → CSS extraction  BURAYA
        if (nuxtEnabled) {
            const nuxtConfigs = await vscode.workspace.findFiles(
                '**/nuxt.config.{js,ts,mjs}',
                '**/node_modules/**'
            );

            for (const cfg of nuxtConfigs) {
                try {
                    const content = await fs.promises.readFile(cfg.fsPath, 'utf-8');
                    const cssUrls = this.extractCssFromNuxtConfig(content);

                    for (const url of cssUrls) {
                        if (url.startsWith('http')) {
                            const css = await fetchUrlCached(url);
                            allIcons.push(...(await this.extractIcons(css, url)));
                        } else {
                            const resolved = this.resolveWorkspaceCss(url);
                            if (resolved) {
                                allIcons.push(...(await this.parseCssFile(resolved)));
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Failed to parse nuxt config:', cfg.fsPath, e);
                }
            }
        }

        // 4. Next.js globals.css
        if (nextEnabled) {
            await this.scanNextJsGlobals(allIcons);
        }

        // 5. React entry css
        if (reactEnabled) {
            await this.scanReactEntry(allIcons);
        }

        // 6. React / Vue / Nuxt usage tarama
        if (scanJsTs || scanHtml || scanPhp) {
            await this.scanFrameworkUsages(allIcons, {
                vue: vueEnabled,
                nuxt: nuxtEnabled,
                react: reactEnabled,
                next: nextEnabled,
                scanPhp,
                scanJsTs,
                scanHtml,
            });
        }

        // 7. workspace css kapalıysa ama framework aktifse
        if (!autoScanCss && (reactEnabled || nextEnabled || vueEnabled || nuxtEnabled)) {
            await this.scanCssImportsFromCode(allIcons);
        }

        // 8 TREE-SHAKING ANALİZİ
        TreeShaker.treeShakingReports = TreeShaker.detectTreeShaking(
            allIcons,
            this.usedIconClasses
        );
        //TREE-SHAKING dialog
        TreeShaker.showTreeShakingNotifications(TreeShaker.treeShakingReports, force);

        this.cache = allIcons;
        this.iconCache.set(cacheKey, allIcons);
        this.isScanning = false;
        return allIcons;
    }

    private static async scanCssImportsFromCode(allIcons: IconDefinition[]) {
        const files = await vscode.workspace.findFiles(
            '**/*.{js,jsx,ts,tsx,vue}',
            '**/node_modules/**'
        );

        const CSS_IMPORT_REGEX =
            /import\s+['"]([^'"]+\.css)['"]|require\(\s*['"]([^'"]+\.css)['"]\s*\)/g;

        for (const file of files) {
            const content = (await vscode.workspace.fs.readFile(file)).toString();
            const commentRanges = await getCommentRanges(content);
            let match;
            while ((match = CSS_IMPORT_REGEX.exec(content)) !== null) {
                if (isInsideComment(match.index, commentRanges)) {
                    continue; // ← SİKTİR ET, YOK SAY
                }
                const cssPath = match[1] || match[2];
                const resolved = this.resolveWorkspaceCss(cssPath, file.fsPath);
                if (resolved) {
                    allIcons.push(...(await this.parseCssFile(resolved)));
                }
            }
        }
    }

    private static resolveWorkspaceCss(
        cssPath: string,
        importer?: string
    ): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return null;

        for (const folder of workspaceFolders) {
            const root = folder.uri.fsPath;

            // ~/ or @/  → project root
            if (cssPath.startsWith('~/') || cssPath.startsWith('@/')) {
                const resolved = path.join(root, cssPath.replace(/^~\/|^@\//, ''));
                if (fs.existsSync(resolved)) return resolved;
            }

            // relative path
            if ((cssPath.startsWith('./') || cssPath.startsWith('../')) && importer) {
                const baseDir = path.dirname(importer);
                const resolved = path.resolve(baseDir, cssPath);
                if (fs.existsSync(resolved)) return resolved;
            }

            // node_modules
            const nodeModulePath = path.join(root, 'node_modules', cssPath);
            if (fs.existsSync(nodeModulePath)) return nodeModulePath;

            // direct under root
            const direct = path.join(root, cssPath);
            if (fs.existsSync(direct)) return direct;
        }

        return null;
    }

    private static extractCssFromNuxtConfig(content: string): string[] {
        const urls: string[] = [];

        // css: [ '...', "..." ]
        const cssArrayRegex = /css\s*:\s*\[([\s\S]*?)\]/g;
        const stringRegex = /['"`]([^'"`]+\.css)['"`]/g;

        let m;
        while ((m = cssArrayRegex.exec(content)) !== null) {
            let sm;
            while ((sm = stringRegex.exec(m[1])) !== null) {
                urls.push(sm[1]);
            }
        }

        // href: "https://..."
        const hrefRegex = /href\s*:\s*['"`](https?:\/\/[^'"`]+\.css)['"`]/g;
        while ((m = hrefRegex.exec(content)) !== null) {
            urls.push(m[1]);
        }

        return urls;
    }

    private static async scanNextJsGlobals(allIcons: IconDefinition[]) {
        const entryFiles = await vscode.workspace.findFiles(
            '{app/layout.tsx,pages/_app.tsx}',
            '**/node_modules/**'
        );

        for (const file of entryFiles) {
            const content = await fs.promises.readFile(file.fsPath, 'utf-8');
            const commentRanges = await getCommentRanges(content);

            const IMPORT_CSS_REGEX = /import\s+['"]([^'"]+\.css)['"]/g;

            let match: RegExpExecArray | null;
            while ((match = IMPORT_CSS_REGEX.exec(content)) !== null) {
                // COMMENT İÇİNDEYSE → YOK SAY
                if (isInsideComment(match.index, commentRanges)) {
                    continue;
                }

                const cssPath = match[1];

                if (cssPath.startsWith('http')) {
                    const css = await fetchUrl(cssPath);
                    allIcons.push(...(await this.extractIcons(css, cssPath)));
                } else {
                    const resolved = this.resolveWorkspaceCss(cssPath, file.fsPath);
                    if (resolved) {
                        allIcons.push(...(await this.parseCssFile(resolved)));
                    }
                }
            }
        }
    }

    private static async scanFrameworkUsages(
        allIcons: IconDefinition[],
        options: {
            vue: boolean;
            nuxt: boolean;
            react: boolean;
            next: boolean;
            scanPhp: boolean;
            scanJsTs: boolean;
            scanHtml: boolean;
        }
    ) {
        this.usedIconClasses.clear();

        // const files = await vscode.workspace.findFiles(
        //     '**/*.{js,jsx,ts,tsx,vue,html}',
        //     '**/node_modules/**'
        // );

        const globs: string[] = [];

        if (options.scanJsTs) globs.push('js', 'jsx', 'ts', 'tsx');
        if (options.vue || options.nuxt) globs.push('vue');
        if (options.scanHtml) globs.push('html');
        if (options.scanPhp) globs.push('php');

        if (!globs.length) return;

        const files = await vscode.workspace.findFiles(
            `**/*.{${globs.join(',')}}`,
            '**/node_modules/**'
        );
        const iconMap = new Map<string, IconDefinition>();
        for (const icon of allIcons) {
            iconMap.set(icon.className, icon);
        }

        const CLASS_REGEX = /(class|className)\s*=\s*(["'`])([^"'`]+)\2/g;

        await this.processInBatches(files, 50, async (file) => {
            const content = (await vscode.workspace.fs.readFile(file)).toString();
            const commentRanges = await getCommentRanges(content);

            // Vue için sadece <template>
            const templateMatch = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(content);
            const scanContent = templateMatch?.[1] ?? content;

            let match;
            while ((match = CLASS_REGEX.exec(scanContent)) !== null) {
                if (isInsideComment(match.index, commentRanges)) {
                    continue; // ← BU ICON KULLANILMADI
                }

                const classes = match[3].split(/\s+/);

                for (const cls of classes) {
                    const icon = iconMap.get(cls);
                    if (icon) {
                        //icon.sourceFile = file.fsPath;

                        //TREE-SHAKING RAPOR İÇİN
                        this.usedIconClasses.add(icon.className);
                    }
                }
            }
        });
    }

    private static async scanReactEntry(allIcons: IconDefinition[]) {
        const entryFiles = await vscode.workspace.findFiles(
            '{src/index.tsx,src/index.jsx,src/main.tsx,src/main.jsx}',
            '**/node_modules/**'
        );

        for (const file of entryFiles) {
            const content = await fs.promises.readFile(file.fsPath, 'utf-8');
            const commentRanges = await getCommentRanges(content);

            const IMPORT_CSS_REGEX = /import\s+['"]([^'"]+\.css)['"]/g;

            let match: RegExpExecArray | null;
            while ((match = IMPORT_CSS_REGEX.exec(content)) !== null) {
                // COMMENT İÇİNDEYSE → TAMAMEN YOK SAY
                if (isInsideComment(match.index, commentRanges)) {
                    continue;
                }

                const cssPath = match[1];

                if (cssPath.startsWith('http')) {
                    const css = await fetchUrl(cssPath);
                    allIcons.push(...(await this.extractIcons(css, cssPath)));
                } else {
                    const resolved = this.resolveWorkspaceCss(cssPath, file.fsPath);
                    if (resolved) {
                        allIcons.push(...(await this.parseCssFile(resolved)));
                    }
                }
            }
        }
    }

    private static async findRemoteCssUrls(
        htmlFiles: vscode.Uri[]
    ): Promise<Set<string>> {
        const urls = new Set<string>();
        //const linkRegex = /<link[^>]+href=["'](https?:\/\/[^"']+\.css)["'][^>]*>/gi;
        const linkRegex =
            /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;

        await this.processInBatches(htmlFiles, 50, async (file) => {
            try {
                const uint8Array = await vscode.workspace.fs.readFile(file);
                let content = new TextDecoder().decode(uint8Array);

                const commentRanges = await getCommentRanges(content);

                let match;
                while ((match = linkRegex.exec(content)) !== null) {
                    if (isInsideComment(match.index, commentRanges)) {
                        continue; // COMMENT İÇİNDE → YOK SAY
                    }
                    urls.add(match[1]);
                }
            } catch (e) {
                console.error(`Error reading HTML file ${file.fsPath}`, e);
            }
        });

        return urls;
    }

    public static async parseCssFile(filePath: string): Promise<IconDefinition[]> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');

            // FA / icon font değilse hiç uğraşma
            if (!this.isLikelyIconFont(content)) return [];

            return this.extractIcons(content, filePath);
        } catch (error) {
            console.error(`Error parsing CSS file ${filePath}:`, error);
            return [];
        }
    }
    // css dosyasından @font-face bloklarını oku ve font url lerini ayıkla
    // font-family -> fontUrl eşlemesini çıkar
    // Tüm kütüphaneler için (FA5, FA6, Boxicons, vs.) multi src desteklidir
    private static extractFontFaces(
        content: string,
        baseUrl: string
    ): Map<string, string[]> {
        // url içinden gelen path’lerde query ve hash’i temizler
        // örn: fa-solid-900.woff2?#iefix -> fa-solid-900.woff2
        const normalizeFontUrl = (url: string) => url.split(/[?#]/)[0];

        // font-family -> resolved font url
        const fontMap = new Map<string, string[]>();

        // @font-face bloklarını yakalar
        const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
        let match: RegExpExecArray | null;

        while ((match = fontFaceRegex.exec(content)) !== null) {
            const ruleBody = match[1];

            // -----------------------------
            // 1 font-family çıkar
            // -----------------------------
            // "Font Awesome 5 Free"
            let familyMatch = /font-family\s*:\s*["']([^"']+)["']/i.exec(ruleBody);

            // Font Awesome 5 Free
            if (!familyMatch) {
                familyMatch = /font-family\s*:\s*([^;!]+)/i.exec(ruleBody);
            }

            if (!familyMatch) continue;

            const fontFamily = familyMatch[1].trim();

            // -----------------------------
            // 2 ruleBody içindeki TÜM url()’leri tara
            // -----------------------------
            // woff2 > woff > ttf > otf
            // svg ve eot bilerek dışarıda
            const urlRegex =
                /url\(["']?([^"')]+?\.(woff2?|woff|ttf|otf)[^"')]*?)["']?\)/gi;

            let urlMatch: RegExpExecArray | null;

            while ((urlMatch = urlRegex.exec(ruleBody)) !== null) {
                // ham url
                let fontUrl = normalizeFontUrl(urlMatch[1]);

                // -----------------------------
                // 3 eot atla (opentype.js desteklemiyor)
                // -----------------------------
                if (fontUrl.endsWith('.eot')) continue;

                // -----------------------------
                // 4 relative path ise absolute hale getir
                // -----------------------------
                if (!fontUrl.startsWith('http://') && !fontUrl.startsWith('https://')) {
                    if (baseUrl.startsWith('http')) {
                        // remote css (CDN)
                        const cssBaseUrl = baseUrl.substring(
                            0,
                            baseUrl.lastIndexOf('/') + 1
                        );
                        fontUrl = new URL(fontUrl, cssBaseUrl).href;
                    } else {
                        // local css (workspace / extension)
                        const cssDir = path.dirname(baseUrl);
                        const absolutePath = path.resolve(cssDir, fontUrl);
                        fontUrl = pathToFileURL(absolutePath).href;
                    }
                }

                // -----------------------------
                // 5 aynı font-family için
                // ilk geçerli font yeterlidir
                // (tarayıcı davranışı)
                // -----------------------------
                //fontMap.set(fontFamily, fontUrl);
                //break;
                if (!fontMap.has(fontFamily)) {
                    fontMap.set(fontFamily, []);
                }
                fontMap.get(fontFamily)!.push(fontUrl);
            }
        }

        return fontMap;
    }

    // //css dosyasından font-face bul ve font url lerini ayıkla
    // //font-family -> fontUrl eşlemesini çıkar -tekli versiyon
    // private static extractFontFaces(content: string, baseUrl: string): Map<string, string> {

    //     // url içinden gelen path’lerde query ve hash’i temizle
    //     const normalizeFontUrl = (url: string) => url.split(/[?#]/)[0];

    //     // font-family -> resolved font url
    //     const fontMap = new Map<string, string>();

    //     //@font-face bloklarını yakala
    //     const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
    //     let match;

    //     while ((match = fontFaceRegex.exec(content)) !== null) {
    //         const ruleBody = match[1];

    //         //font-family çıkarma (fallback’li)(boşluklu ve boşluksuz versiyonlar)
    //         let familyMatch = /font-family\s*:\s*["']([^"']+)["']/i.exec(ruleBody);
    //         if (!familyMatch) familyMatch = /font-family\s*:\s*([^;!]+)/i.exec(ruleBody);
    //         if (!familyMatch) continue;
    //         const fontFamily = familyMatch[1].trim();

    //         //src: satırını yakala
    //         const srcMatch = /src\s*:\s*([^;]+)/i.exec(ruleBody);

    //         // ---- BOXICONS FIX (çoklu src:) FA5 okumamasının sorumlusu burası...----
    //         //FA5 ve altındakilerde src içinde multiple url olabilir, biz ilkini alıyoruz
    //         if (fontFamily.toLowerCase().includes('boxicons')) {

    //             //ruleBody içinde tüm url()’leri dolaş
    //             const urlRegex = /url\(["']?([^"')]+?\.(woff2?|woff|ttf|otf)[^"')]*?)["']?\)/gi;
    //             let urlMatch: RegExpExecArray | null;

    //             while ((urlMatch = urlRegex.exec(ruleBody)) !== null) {
    //                 let fontUrl = normalizeFontUrl(urlMatch[1]);

    //                 // eot atlıyorum çünkü siktiğimin opentype.js desteklemiyor/destkleyemiyor
    //                 if (fontUrl.endsWith('.eot')) continue;

    //                 if (!fontUrl.startsWith('http://') && !fontUrl.startsWith('https://')) {
    //                     if (baseUrl.startsWith('http')) {
    //                         const cssBaseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    //                         fontUrl = new URL(fontUrl, cssBaseUrl).href;
    //                     } else {
    //                         const cssDir = path.dirname(baseUrl);
    //                         const absolutePath = path.resolve(cssDir, fontUrl);
    //                         fontUrl = pathToFileURL(absolutePath).href;
    //                     }
    //                 }

    //                 // ilk bulduğumuzu yeterli kabul ediyoruz
    //                 fontMap.set(fontFamily, fontUrl);

    //                 break;//Aynı font-family için tek font yeterli
    //             }

    //             // boxicons işlendi → default FA logic'e girme
    //             continue;
    //         }

    //         if (!srcMatch) continue;
    //         const srcValue = srcMatch[1];

    //         let urlMatch = /url\(["']?([^"')]+\.woff2[^"')]*?)["']?\)/i.exec(srcValue);
    //         if (!urlMatch) urlMatch = /url\(["']?([^"')]+\.woff[^"')]*?)["']?\)/i.exec(srcValue);
    //         if (!urlMatch) urlMatch = /url\(["']?([^"')]+\.(ttf|otf)[^"')]*?)["']?\)/i.exec(srcValue);
    //         if (!urlMatch) continue;

    //         let fontUrl = urlMatch[1];
    //         fontUrl = fontUrl.split(/[?#]/)[0];
    //         if (fontUrl.endsWith('.eot')) continue; // <-- Bunu ekledim eot atlamak için
    //         if (!fontUrl.startsWith('http://') && !fontUrl.startsWith('https://')) {

    //             // REMOTE CSS İSE
    //             if (baseUrl.startsWith('http')) {
    //                 const cssBaseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    //                 fontUrl = new URL(fontUrl, cssBaseUrl).href;
    //             } else {
    //                 const cssDir = path.dirname(baseUrl);
    //                 const absolutePath = path.resolve(cssDir, fontUrl);
    //                 fontUrl = pathToFileURL(absolutePath).href;
    //             }
    //         }

    //         fontMap.set(fontFamily, fontUrl);
    //     }
    //     return fontMap;
    // }

    private static boxiconsFontUrls: string[] = [];

    private static resolveFontUrls(isBoxicon: boolean, iconFontUrls: string[]): string[] {
        if (isBoxicon && CssScanner.boxiconsFontUrls.length) {
            return CssScanner.boxiconsFontUrls;
        }
        return iconFontUrls;
    }

    // --- FA7 uyumlu extractIcons ---
    public static async extractIcons(
        content: string,
        sourceName: string
    ): Promise<IconDefinition[]> {
        const icons: IconDefinition[] = [];
        const uniqueParams = new Set<string>();
        const commentRanges = await getCommentRanges(content);

        const fontMap = this.extractFontFaces(content, sourceName);
        const iconFontUrls: string[] = [];
        for (const [family, urls] of fontMap.entries()) {
            if (
                family.toLowerCase().includes('font awesome') ||
                family.toLowerCase().includes('bootstrap') ||
                family.toLowerCase().includes('icon')
            ) {
                for (const url of urls) {
                    if (!iconFontUrls.includes(url)) {
                        iconFontUrls.push(url);
                    }
                }
            }
        }

        // ---- Boxicons font URL'lerini global cache'e al ----
        // for (const [family, urls] of fontMap.entries()) {
        //     if (family.toLowerCase().includes('boxicons')) {
        //         for (const url of urls) {
        //             if (!CssScanner.boxiconsFontUrls.includes(url)) {
        //                 CssScanner.boxiconsFontUrls.push(url);
        //             }
        //         }
        //     }
        // }

        if (iconFontUrls.length === 0 && fontMap.size > 0) {
            const allUrls = Array.from(fontMap.values()).flat();
            for (const url of allUrls) {
                if (!iconFontUrls.includes(url)) {
                    iconFontUrls.push(url);
                }
            }
        }
        iconFontUrls.sort((a, b) => {
            const aScore = a.includes('solid')
                ? 0
                : a.includes('regular')
                  ? 1
                  : a.includes('brands')
                    ? 2
                    : 3;
            const bScore = b.includes('solid')
                ? 0
                : b.includes('regular')
                  ? 1
                  : b.includes('brands')
                    ? 2
                    : 3;
            return aScore - bScore;
        });

        const ruleRegex = /([^{]+)\{([^}]+)\}/g;
        let match: RegExpExecArray | null;

        while ((match = ruleRegex.exec(content)) !== null) {
            //  RULE COMMENT İÇİNDEYSE → TAMAMEN ATLA LAN O.Ç.
            if (isInsideComment(match.index, commentRanges)) {
                continue;
            }

            const selector = match[1];
            const body = match[2];
            //if (!/content\s*:|--fa\s*:/.test(body)) continue;
            //const allowedPrefixes = ['fas', 'far', 'fab', 'fal', 'fad', 'fa', 'bi', 'bx', 'bxs', 'bxl'];

            if (!/content\s*:|--fa\s*:/.test(body)) continue;

            if (/^\s*:/.test(selector)) continue;

            const contentValueMatch =
                /(?:content|--fa)\s*:\s*(?:["']\\?([a-fA-F0-9]+)["']|\\?([a-fA-F0-9]+))/i.exec(
                    body
                );
            const cssValue = contentValueMatch
                ? contentValueMatch[1] || contentValueMatch[2]
                : undefined;
            if (!cssValue) continue;

            // --- FA7 uyumlu prefix parsing ---
            const classRegex = /\.([a-zA-Z0-9_\-]+)/g;
            const classesInSelector: { className: string; prefix?: string }[] = [];
            let classMatch;
            while ((classMatch = classRegex.exec(selector)) !== null) {
                const fullClass = classMatch[1];

                // Eğer className doğrudan boxicons/fa tarzı prefix ile başlıyorsa bunu yakala:
                // örn: bxs-user -> prefix bxs, bx-user -> prefix bx, bxl-facebook -> prefix bxl
                // örn: fas-user (nadiren) -> fas
                let inferredPrefix: string | undefined;
                if (/^(bxs|bxl|bx)-/i.test(fullClass)) {
                    inferredPrefix = detectBoxiconsFontType(fullClass, sourceName);
                } else if (/^(fas|far|fal|fad|fab|fa)-/i.test(fullClass)) {
                    inferredPrefix = fullClass.split('-', 1)[0].toLowerCase();
                } else {
                    inferredPrefix = detectIconPrefix(fullClass);
                }

                // FA7 prefix tespiti (fas/far/fal/fad/fab) - eğer selector içinde sadece prefix yazıldıysa atla
                const prefixMatch = /^(fas|far|fal|fad|fab)$/i.exec(fullClass);
                if (prefixMatch) continue;

                // Önceki text içinde prefix varsa al
                const prevIndex = classRegex.lastIndex - fullClass.length - 1;
                const prevText = selector.substring(0, prevIndex).trim();

                let prefix: string | undefined;

                // Tüm prefix türlerini yakala:
                //const prevPrefixMatch = /(fas|far|fal|fad|fab|fa|bi|bxs|bx|bxl)/i.exec(prevText); //bxicon prefix classNameden geliyor
                const prevPrefixMatch = /(fas|far|fal|fad|fab|fa|bi)/i.exec(prevText);
                if (prevPrefixMatch) {
                    prefix = prevPrefixMatch[1].toLowerCase();
                }

                // detectIconPrefix ile tamamlama
                let detectedPrefix: string | undefined;

                if (sourceName.toLowerCase().includes('boxicons')) {
                    detectedPrefix = detectBoxiconsFontType(sourceName);
                }
                // Eğer boxicons değilse veya path'ten alamadıysak, classname'dan al
                if (!detectedPrefix) {
                    detectedPrefix =
                        inferredPrefix || prefix || detectIconPrefix(fullClass);
                }

                classesInSelector.push({
                    className: fullClass,
                    prefix: detectedPrefix,
                });
                console.log('prefix:', detectedPrefix);
            }

            // Her prefix + class ayrı IconDefinition
            for (const { className, prefix } of classesInSelector) {
                //BOXICONS MU?
                const isBoxicon = prefix === 'bx' || prefix === 'bxs' || prefix === 'bxl';

                const allUrls = CssScanner.resolveFontUrls(isBoxicon, iconFontUrls);

                if (!allUrls.length) {
                    console.warn('NO FONT URL FOR ICON:', className, prefix);
                    continue;
                }
                const library = this.resolveLibrary(content, sourceName);
                if (library) {
                    // PREFIX ↔ LIBRARY DOĞRULAMA (DOĞRU YER)LIBRARY FILTER (SAFE VERSION)
                    if (library?.id === 'bootstrap-icons') {
                        if (!prefix && !className.startsWith('bi-')) continue;
                        if (prefix && prefix !== 'bi') continue;
                    }

                    if (library?.id === 'boxicons') {
                        if (!prefix) continue; //css içinde eğer prefix yoksa atla
                        if (prefix && !['bx', 'bxl', 'bxs'].includes(prefix)) {
                            continue;
                        }
                    }

                    //Font Awesome için prefix’siz class’lar geçebilir?o yüzden şimdilik kapalı tutuyorum
                    // if (library?.id === 'font-awesome') {
                    //     if (prefix && !['fa', 'fas', 'far', 'fal', 'fad', 'fab'].includes(prefix)) {
                    //         continue;
                    //     }
                    // }

                    const exists = TreeShaker.detectedLibraries.some(
                        (l) =>
                            l.id === library.id &&
                            l.version === library.version &&
                            l.cssPath === library.cssPath
                    );

                    if (!exists) {
                        TreeShaker.detectedLibraries.push({
                            id: library.id,
                            version: library.version ?? 'unknown',
                            cssPath: library.cssPath,
                        });
                    }
                }

                //unicode hangi font dosyasının içinde
                const matchedFontUrl = await FontManager.findFontContainingGlyph(
                    parseInt(cssValue, 16),
                    allUrls
                );

                //font dosyasından benzersiz font-family adı üret
                const fontFamily = matchedFontUrl
                    ? FontManager.getFontFamilyName(matchedFontUrl)
                    : undefined;

                //ikonun tekil kimliği
                const uniqueKey = `${prefix ?? 'fa'}| ${matchedFontUrl}|${fontFamily} |${className}`;
                if (!uniqueParams.has(uniqueKey)) {
                    uniqueParams.add(uniqueKey);
                    icons.push({
                        className,
                        prefix: prefix,
                        cssValue,
                        sourceFile: sourceName,
                        fontUrl: matchedFontUrl, // Font URL’yi önceden bulduk
                        allFontUrls: allUrls,
                        fontFamily,
                        isAlias: false, //this.aliasMap.has(className),
                        detectedFontType: prefix ? [prefix] : undefined,
                        library,
                    });
                    // console.log('Extracted icon:', className, 'from', sourceName,'prefix:',prefix);
                }
            }
        }

        // Unicode gruplama ve font detection
        const unicodeGroups = new Map<string, IconDefinition[]>();
        for (const icon of icons) {
            if (icon.cssValue) {
                if (!unicodeGroups.has(icon.cssValue))
                    unicodeGroups.set(icon.cssValue, []);
                unicodeGroups.get(icon.cssValue)!.push(icon);
            }
        }

        const unicodeEntries = Array.from(unicodeGroups.entries());
        let uIndex = 0;
        const CONCURRENCY_UNICODES = 10; //ünicode için eşzamanlı işçi sayısı(fazlası yorar lan adamı)

        // async function unicodeWorker() {
        //     while (true) {
        //         const ui = uIndex++;
        //         if (ui >= unicodeEntries.length) return;
        //         const [unicode, group] = unicodeEntries[ui];
        //         const candidateUrls = Array.from(new Set(group.flatMap(g => g.allFontUrls || [])));

        //         // ---- BOXICONS: unicode taramasını tamamen atla ----
        //         if (group[0]?.library?.id === 'boxicons') {
        //             for (const icon of group) {
        //                 icon.detectedFontType = [
        //                     CssScanner.detectBoxiconsFontType(
        //                         icon.library?.cssPath ||
        //                         icon.sourceFile ||
        //                         icon.fontUrl ||
        //                         ''
        //                     )
        //                 ];
        //                 // fontUrl zaten extractIcons'ta doğru geliyor
        //             }
        //             continue;
        //         }

        //         // if (candidateUrls.length === 0) {
        //         //     // Boxicons özel durumu
        //         //     if (group[0]?.prefix?.startsWith('bx')) {
        //         //         candidateUrls.push(...CssScanner.boxiconsFontUrls);
        //         //     } else {
        //         //         candidateUrls.push(...iconFontUrls);
        //         //     }
        //         // }

        //         try {
        //             //chace li yapı ve chace siz yapı ayrımı(FA da chace siz kullanmak zorundayız ikonun varyant butonları için)
        //             const isFontAwesome =
        //                 group[0]?.prefix?.startsWith('fa') ||
        //                 candidateUrls.some(u => u.includes('fontawesome'));

        //             const foundFontUrls = isFontAwesome
        //                 ? await CssScanner.detectFontUrlsForUnicode(unicode, candidateUrls)
        //                 : await CssScanner.detectFontUrlsForUnicodeCached(unicode, candidateUrls);

        //             const detectedTypes = foundFontUrls.length
        //                 ? Array.from(new Set(foundFontUrls.map(url => CssScanner.detectFontTypeForUnic(url))))
        //                 : null;

        //             for (const icon of group) {

        //                 // ---- BOXICONS: prefix her zaman icon.prefix'ten gelir ----
        //                 if (icon.library?.id === 'boxicons') {
        //                     const cssPath =
        //                         icon.library?.cssPath ||
        //                         icon.sourceFile ||
        //                         icon.fontUrl ||
        //                         '';

        //                     icon.detectedFontType = [
        //                         CssScanner.detectBoxiconsFontType(cssPath)
        //                     ];
        //                     continue;
        //                 } else if (!detectedTypes) {
        //                     const heur = CssScanner.detectFontTypeForUnic(
        //                         icon.fontUrl || (icon.allFontUrls?.[0] ?? "")
        //                     );
        //                     icon.detectedFontType = [heur];
        //                 } else {
        //                     icon.detectedFontType = detectedTypes;
        //                 }

        //                 if (foundFontUrls.length) {
        //                     icon.allFontUrls = foundFontUrls;
        //                     icon.fontUrl = foundFontUrls[0];
        //                 }
        //             }
        //         } catch (e) {
        //             for (const icon of group) {
        //                 const heur = CssScanner.detectFontTypeForUnic(icon.fontUrl || (icon.allFontUrls?.[0] ?? ""));
        //                 icon.detectedFontType = [heur];
        //             }
        //         }
        //     }
        // }

        function isFontAwesomeGroup(group: IconDefinition[]): boolean {
            return group.some((icon) => {
                const p = icon.prefix;
                if (!p) return false;

                const prefixes = Array.isArray(p) ? p : [p];
                return prefixes.some((px) => px.startsWith('fa'));
            });
        }

        async function unicodeWorker() {
            while (true) {
                const ui = uIndex++;
                if (ui >= unicodeEntries.length) return;

                const [unicode, group] = unicodeEntries[ui];
                const candidateUrls = Array.from(
                    new Set(group.flatMap((g) => g.allFontUrls || []))
                );

                // =====================================================
                // BOXICONS: unicode taraması YAPMA
                // Prefix → font ilişkisi deterministik
                // =====================================================
                if (group[0]?.library?.id === 'boxicons') {
                    for (const icon of group) {
                        icon.detectedFontType = [
                            detectBoxiconsFontType(
                                icon.library?.cssPath ||
                                    icon.sourceFile ||
                                    icon.fontUrl ||
                                    ''
                            ),
                        ];
                        // fontUrl zaten extractIcons'ta doğru
                    }
                    continue;
                }

                try {
                    const isFontAwesome = isFontAwesomeGroup(group);

                    const foundFontUrls = isFontAwesome
                        ? await CssScanner.detectFontUrlsForUnicode(
                              unicode,
                              candidateUrls
                          )
                        : await CssScanner.detectFontUrlsForUnicodeCached(
                              unicode,
                              candidateUrls
                          );

                    const detectedTypes = foundFontUrls.length
                        ? Array.from(
                              new Set(
                                  foundFontUrls.map((url) => detectFontTypeForUnic(url))
                              )
                          )
                        : null;

                    for (const icon of group) {
                        if (!detectedTypes) {
                            const heur = detectFontTypeForUnic(
                                icon.fontUrl || icon.allFontUrls?.[0] || ''
                            );
                            icon.detectedFontType = [heur];
                        } else {
                            icon.detectedFontType = detectedTypes;
                        }

                        if (foundFontUrls.length) {
                            icon.allFontUrls = foundFontUrls;
                            icon.fontUrl = foundFontUrls[0];
                        }
                    }
                } catch {
                    for (const icon of group) {
                        const heur = detectFontTypeForUnic(
                            icon.fontUrl || icon.allFontUrls?.[0] || ''
                        );
                        icon.detectedFontType = [heur];
                    }
                }
            }
        }

        const workers = [];
        for (let i = 0; i < CONCURRENCY_UNICODES; i++) workers.push(unicodeWorker());
        await Promise.all(workers);

        // Sibling class'lar ve unicode map
        for (const [unicode, group] of unicodeGroups.entries()) {
            const classNames = group.map((icon) => icon.className);
            this.unicodeToClassesMap.set(unicode, classNames);
            for (const icon of group) {
                icon.siblingClassNames = classNames;
                icon.isAlias = classNames.length > 1;
            }
        }

        return icons;
    }

    //detectFontUrlsForUnicode chace siz eski yapı, FA ,.,n mecburen kullanıyoruz.
    private static async detectFontUrlsForUnicode(
        unicodeHex: string,
        fontUrls: string[]
    ): Promise<string[]> {
        if (!fontUrls || fontUrls.length === 0) return [];
        const charCode = parseInt(unicodeHex, 16);
        if (!charCode) return [];
        const char = String.fromCharCode(charCode);
        const found: string[] = [];

        for (let url of fontUrls) {
            try {
                url = url.split('?')[0];
                if (url.endsWith('.eot')) continue;

                const font = await FontManager.loadFontFromUrl(url);
                if (!font) continue;

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
            } catch (err) {
                console.warn('Font test failed:', url, err);
            }
        }
        return found;
    }

    private static remoteFontCache: Map<string, Set<string>> = new Map();

    //chace yapı tek tip dönmesine sebep oldu sonradan fixlenebilir.
    private static async detectFontUrlsForUnicodeCached(
        unicodeHex: string,
        fontUrls: string[]
    ): Promise<string[]> {
        const results: string[] = [];
        const charCode = parseInt(unicodeHex, 16);
        if (!charCode) return results;
        for (const url of fontUrls) {
            if (!this.remoteFontCache.has(url)) this.remoteFontCache.set(url, new Set());
            const cachedSet = this.remoteFontCache.get(url)!;
            if (cachedSet.has(unicodeHex)) {
                results.push(url);
                continue;
            }
            try {
                const font = await FontManager.loadFontFromUrl(url);
                if (!font) continue;
                const char = String.fromCharCode(charCode);
                const glyph = font.charToGlyph(char);
                if (glyph && glyph.index !== 0 && glyph.name !== '.notdef') {
                    cachedSet.add(unicodeHex);
                    results.push(url);
                }
            } catch (e) {
                console.warn('Font check failed:', url, e);
            }
        }
        return results;
    }

    private static libraryCache = new Map<string, IconLibraryInfo | undefined>();

    private static isLikelyIconFont(css: string): boolean {
        return (
            /@font-face/i.test(css) &&
            (/font-awesome|font awesome/i.test(css) ||
                /--fa-/i.test(css) || // <<< KRİTİK
                /fa-[a-z]+-\d{3}/i.test(css) || // fa-solid-900 vs
                /bootstrap-icons/i.test(css) ||
                /boxicons/i.test(css))
        );

        //      return (
        //     /@font-face/i.test(css) &&
        //     (
        //       /font awesome/i.test(css) ||
        //       /--fa\s*:/i.test(css) ||
        //       /bootstrap-icons/i.test(css) ||
        //       /boxicons/i.test(css)
        //     )
        // );
        // return (
        //     /@font-face/i.test(css) &&
        //     /content\s*:\s*["']\\[a-f0-9]+["']/i.test(css)
        // );
    }

    private static resolveLibrary(
        cssContent: string,
        filePath: string
    ): IconLibraryInfo | undefined {
        if (this.libraryCache.has(filePath)) {
            return this.libraryCache.get(filePath);
        }

        for (const detector of LIBRARY_DETECTORS) {
            if (detector.match(cssContent, filePath)) {
                const lib = detector.extract(cssContent, filePath);
                this.libraryCache.set(filePath, lib);
                return lib;
            }
        }
        if (this.isLikelyIconFont(cssContent)) {
            const v = resolveVersion(cssContent, filePath);
            return {
                id: 'unknown',
                shortName: '?',
                displayName: 'Unknown Icon Font',
                version: v.version,
                cssPath: filePath,
                confidence: 'low',
            };
        }
        this.libraryCache.set(filePath, undefined);
        return undefined;
    }

    public static getIcons(): IconDefinition[] {
        return this.cache;
    }

    public static getAliasMap(): Map<string, string> {
        return this.aliasMap;
    }

    public static getPrimaryClassName(className: string): string {
        return this.aliasMap.get(className) || className;
    }

    public static clearCache(): void {
        this.cache = [];
        this.iconCache.clear(); // BU YOKTU
        this.aliasMap.clear();
        this.unicodeToClassesMap.clear();
        this.usedIconClasses.clear();
        this.libraryCache.clear();
        console.log('CssScanner cache cleared');
    }
}
