import * as opentype from 'opentype.js';
import * as https from 'https';
import * as http from 'http';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import { IconDefinition } from '../types/icons';
import { decompress } from 'wawoff2';

export class FontManager {
    private static fontCache = new Map<string, opentype.Font>();

    public static clearCache(): void {
        this.fontCache.clear();
        console.log('FontManager cache cleared');
    }

    /**
     * Load a font from a URL (HTTP/HTTPS or local file path)
     */
    public static async loadFontFromUrl(fontUrl: string): Promise<opentype.Font | null> {
        //eot temizliği
        const cleanUrl = fontUrl.split(/[?#]/)[0];
        if (cleanUrl.toLowerCase().endsWith('.eot')) {
            return null;
        }

        fontUrl = fontUrl.split('?')[0];
        const cacheKey = fontUrl;
        if (this.fontCache.has(cacheKey)) {
            return this.fontCache.get(cacheKey)!;
        }

        try {
            let font: opentype.Font;

            if (fontUrl.startsWith('http')) {
                const buffer = await this.fetchFontBuffer(fontUrl);
                let arrayBuffer: ArrayBuffer;

                if (fontUrl.endsWith('.woff2') || this.isWoff2(buffer)) {
                    const decompressed = await decompress(buffer);
                    arrayBuffer = decompressed.buffer.slice(
                        decompressed.byteOffset,
                        decompressed.byteOffset + decompressed.byteLength
                    ) as ArrayBuffer;
                } else {
                    arrayBuffer = buffer.buffer as ArrayBuffer;
                }

                font = opentype.parse(arrayBuffer);
            } else { // --- LOCAL FILE ---

                //eot temizliği
                const cleanUrl = fontUrl.split(/[?#]/)[0];
                if (cleanUrl.toLowerCase().endsWith('.eot')) {
                    return null;
                }


                // Convert file:// URL to path
                if (fontUrl.startsWith('file://')) {
                    fontUrl = fileURLToPath(fontUrl);
                }

                const buffer = await fs.promises.readFile(fontUrl);

                let arrayBuffer: ArrayBuffer;

                if (fontUrl.endsWith('.woff2') || this.isWoff2(buffer)) {
                    const decompressed = await decompress(buffer);
                    arrayBuffer = decompressed.buffer.slice(
                        decompressed.byteOffset,
                        decompressed.byteOffset + decompressed.byteLength
                    ) as ArrayBuffer;
                } else {
                    arrayBuffer = buffer.buffer.slice(
                        buffer.byteOffset,
                        buffer.byteOffset + buffer.byteLength
                    );
                }

                font = opentype.parse(arrayBuffer);
            }

            this.fontCache.set(cacheKey, font);
            return font;

        } catch (error) {
            console.error(`Failed to load font from ${fontUrl}:`, error);
            return null;
        }
    }

    /**
     * Check woff2 magic number
     */
    private static isWoff2(buffer: Uint8Array): boolean {
        return buffer.length >= 4 &&
            buffer[0] === 0x77 &&
            buffer[1] === 0x4F &&
            buffer[2] === 0x46 &&
            buffer[3] === 0x32;
    }

    /**
     * Minimal glyph check (FA7 cmap broken fix)
     */
    private static hasGlyphForUnicode(font: opentype.Font, charCode: number): boolean {
        const char = String.fromCharCode(charCode);

        let glyph = font.charToGlyph(char);
        if (glyph && glyph.index !== 0 && glyph.name !== '.notdef') {
            return true;
        }

        for (let i = 0; i < font.glyphs.length; i++) {
            const g = font.glyphs.get(i);
            if (g.unicodes && g.unicodes.includes(charCode)) {
                return true;
            }
        }

        return false;
    }

    // private static detectFontUrlName(url: string[]): string {
    //     const lower = (url || '').toLowerCase();
    //     if (lower.includes('fas')) return 'solid';
    //     if (lower.includes('fab')) return 'brands';
    //     if (lower.includes('far')) return 'regular';
    //     if (lower.includes('fal')) return 'light';
    //     if (lower.includes('fad')) return 'duotone';
    //     if (lower.includes('bi')) return 'bootstrap';
    //     if (lower.includes("bxl-")) return "boxicons-logo";
    //     if (lower.includes("bxs-")) return "boxicons-solid";
    //     if (lower.includes("bx-")) return "boxicons";
    //     return 'solid';
    // }

    /**
     * NEW: We no longer try fallback fonts
     * Because extractIcons() already knows the correct fontUrl
     */
    // public static async getFontForIcon(iconDef: IconDefinition): Promise<opentype.Font | null> {
    //     if (!iconDef.fontUrl) {
    //         console.warn(`Icon has no fontUrl: ${iconDef.className}`);
    //         return null;
    //     }
    //     let fonturl: string | undefined = undefined;
    //     if (iconDef.prefix) {
    //         const expectedFileName = FontManager.detectFontUrlName(iconDef.prefix);
    //         if (expectedFileName && iconDef.allFontUrls) {
    //             // allFontUrls içinde bu dosyayı içeren gerçek URL'yi bul
    //             const found = iconDef.allFontUrls.find(u => u.includes(expectedFileName));
    //             if (found) {
    //                 fonturl = found; // doğru font URL seçildi
    //             }
    //         }
    //     }

    //     const font = await this.loadFontFromUrl(fonturl ? fonturl : iconDef.fontUrl);
    //     if (!font) return null;

    //     const charCode = iconDef.cssValue ? parseInt(iconDef.cssValue, 16) : 0;

    //     // FA7 fix
    //     if (!this.hasGlyphForUnicode(font, charCode)) {
    //         console.warn(`Glyph not found in font (although URL matched): ${iconDef.className}`);
    //     }

    //     return font;
    // }

public static async getFontForIcon(iconDef: IconDefinition) {
    if (!iconDef.fontUrl) return null;
    return this.loadFontFromUrl(iconDef.fontUrl);
}
    //  GLYPH → FONT CACHE
    private static glyphFontCache = new Map<string, string>();

    public static async findFontContainingGlyph(
        charCode: number,
        allFontUrls: string[]
    ): Promise<string> {

        const cacheKey = `${charCode}|${allFontUrls.join('|')}`;
        const cached = this.glyphFontCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        for (const url of this.sortFontUrls(allFontUrls)) {
            const font = await this.loadFontFromUrl(url);
            if (!font) continue;

            if (this.hasGlyphForUnicode(font, charCode)) {
                this.glyphFontCache.set(cacheKey, url);
                return url; // DOĞRU FONT BULUNDU
            }
        }

        // fallback (en azından bir şey dön)
        const fallback = allFontUrls[0];
        this.glyphFontCache.set(cacheKey, fallback);
        return fallback;
    }
    private static sortFontUrls(urls: string[]): string[] {
        return [...urls].sort((a, b) => {
            if (a.endsWith('.woff2')) return -1;
            if (b.endsWith('.woff2')) return 1;
            if (a.endsWith('.woff')) return -1;
            if (b.endsWith('.woff')) return 1;
            return 0;
        });
    }
    public static hash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36); // daha kısa string için 36 tabanı
    }
    public static getFontFamilyName(fontUrl: string) {
        return '__iconfont_' + this.hash(fontUrl);
    }
    public static getFontFaceCss(fontFamily: string, fontUrl: string): string {
        return `
        @font-face {
            font-family: '${fontFamily}';
            src: url('${fontUrl}') format('woff2');
            font-weight: normal;
            font-style: normal;
        }`;
    }
    /**
     * Fetch font binary from URL
     */
    private static fetchFontBuffer(url: string): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https:') ? https : http;

            client.get(url, (res) => {
                if ([301, 302].includes(res.statusCode!) && res.headers.location) {
                    this.fetchFontBuffer(res.headers.location).then(resolve).catch(reject);
                    return;
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${url}`));
                    return;
                }

                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve(new Uint8Array(Buffer.concat(chunks)));
                });
            }).on('error', reject);
        });
    }


    /**
        * Convert glyph to Raw SVG
        */
    public static glyphToRawSvg(font: opentype.Font, unicodeHex: string ,): string | null {
        try {
            const charCode = parseInt(unicodeHex, 16);
            const char = String.fromCharCode(charCode);

            let glyph = font.charToGlyph(char);

            if (!glyph || glyph.index === 0 || glyph.name === '.notdef') {
                for (let i = 0; i < font.glyphs.length; i++) {
                    const g = font.glyphs.get(i);
                    if (g.unicodes && g.unicodes.includes(charCode)) {
                        glyph = g;
                        break;
                    }
                }
            }

            if (!glyph) return null;

            const fontSize = 48;
            const scale = fontSize / font.unitsPerEm;
            const baselineY = font.ascender * scale;

            const path = glyph.getPath(0, baselineY, fontSize);
            const pathData = path.toPathData(2);

            // --- BOUNDING BOX ---
            const bbox = glyph.getBoundingBox();
            const xMin = bbox.x1 * scale;
            const yMin = bbox.y1 * scale;
            const xMax = bbox.x2 * scale;
            const yMax = bbox.y2 * scale;

            const width = xMax - xMin;
            const height = yMax - yMin;

            // ViewBox'u glyph’e göre ortalayalım
            const padding = 10;

            const viewBox = [
                xMin - padding,
                yMin - padding,
                width + padding * 2,
                height + padding * 2
            ].join(" ");

            return `<svg xmlns="http://www.w3.org/2000/svg" width="${fontSize}" height="${fontSize}" viewBox="${viewBox}">
                <path fill="currentColor" d="${pathData}"/>
            </svg>`.trim();

        } catch(e) {
             console.error('SVG generation error:', e);
            return null;
        }
    }
    /**
     * Convert glyph to SVG
     */
    public static glyphToSvgDataUri(font: opentype.Font, unicodeHex: string): string | null {
        try {
            const charCode = parseInt(unicodeHex, 16);
            const char = String.fromCharCode(charCode);

            let glyph = font.charToGlyph(char);

            if (!glyph || glyph.index === 0 || glyph.name === '.notdef') {
                for (let i = 0; i < font.glyphs.length; i++) {
                    const g = font.glyphs.get(i);
                    if (g.unicodes && g.unicodes.includes(charCode)) {
                        glyph = g;
                        break;
                    }
                }
            }

            if (!glyph) return null;

            const fontSize = 48;
            const scale = fontSize / font.unitsPerEm;
            const y = font.ascender * scale;

            const path = glyph.getPath(0, y, fontSize);
            const pathData = path.toPathData(2);

            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fontSize}" height="${fontSize}" viewBox="0 0 ${fontSize + 20} ${fontSize + 20}">
  <path d="${pathData}" fill="#007ACC"/>
</svg>`;

            return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

        } catch (err) {
            console.error('SVG generation error:', err);
            return null;
        }
    }
}
