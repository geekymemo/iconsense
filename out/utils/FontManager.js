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
exports.FontManager = void 0;
const opentype = __importStar(require("opentype.js"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url_1 = require("url");
const fs = __importStar(require("fs"));
const wawoff2_1 = require("wawoff2");
class FontManager {
    static clearCache() {
        this.fontCache.clear();
        console.log('FontManager cache cleared');
    }
    static async loadFontFromUrl(fontUrl) {
        const cleanUrl = fontUrl.split(/[?#]/)[0];
        if (cleanUrl.toLowerCase().endsWith('.eot')) {
            return null;
        }
        fontUrl = fontUrl.split('?')[0];
        const cacheKey = fontUrl;
        if (this.fontCache.has(cacheKey)) {
            return this.fontCache.get(cacheKey);
        }
        try {
            let font;
            if (fontUrl.startsWith('http')) {
                const buffer = await this.fetchFontBuffer(fontUrl);
                let arrayBuffer;
                if (fontUrl.endsWith('.woff2') || this.isWoff2(buffer)) {
                    const decompressed = await (0, wawoff2_1.decompress)(buffer);
                    arrayBuffer = decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength);
                }
                else {
                    arrayBuffer = buffer.buffer;
                }
                font = opentype.parse(arrayBuffer);
            }
            else {
                const cleanUrl = fontUrl.split(/[?#]/)[0];
                if (cleanUrl.toLowerCase().endsWith('.eot')) {
                    return null;
                }
                if (fontUrl.startsWith('file://')) {
                    fontUrl = (0, url_1.fileURLToPath)(fontUrl);
                }
                const buffer = await fs.promises.readFile(fontUrl);
                let arrayBuffer;
                if (fontUrl.endsWith('.woff2') || this.isWoff2(buffer)) {
                    const decompressed = await (0, wawoff2_1.decompress)(buffer);
                    arrayBuffer = decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength);
                }
                else {
                    arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                }
                font = opentype.parse(arrayBuffer);
            }
            this.fontCache.set(cacheKey, font);
            return font;
        }
        catch (error) {
            console.error(`Failed to load font from ${fontUrl}:`, error);
            return null;
        }
    }
    static isWoff2(buffer) {
        return buffer.length >= 4 &&
            buffer[0] === 0x77 &&
            buffer[1] === 0x4F &&
            buffer[2] === 0x46 &&
            buffer[3] === 0x32;
    }
    static hasGlyphForUnicode(font, charCode) {
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
    static async getFontForIcon(iconDef) {
        if (!iconDef.fontUrl)
            return null;
        return this.loadFontFromUrl(iconDef.fontUrl);
    }
    static async findFontContainingGlyph(charCode, allFontUrls) {
        const cacheKey = `${charCode}|${allFontUrls.join('|')}`;
        const cached = this.glyphFontCache.get(cacheKey);
        if (cached) {
            return cached;
        }
        for (const url of this.sortFontUrls(allFontUrls)) {
            const font = await this.loadFontFromUrl(url);
            if (!font)
                continue;
            if (this.hasGlyphForUnicode(font, charCode)) {
                this.glyphFontCache.set(cacheKey, url);
                return url;
            }
        }
        const fallback = allFontUrls[0];
        this.glyphFontCache.set(cacheKey, fallback);
        return fallback;
    }
    static sortFontUrls(urls) {
        return [...urls].sort((a, b) => {
            if (a.endsWith('.woff2'))
                return -1;
            if (b.endsWith('.woff2'))
                return 1;
            if (a.endsWith('.woff'))
                return -1;
            if (b.endsWith('.woff'))
                return 1;
            return 0;
        });
    }
    static hash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
    static getFontFamilyName(fontUrl) {
        return '__iconfont_' + this.hash(fontUrl);
    }
    static getFontFaceCss(fontFamily, fontUrl) {
        return `
        @font-face {
            font-family: '${fontFamily}';
            src: url('${fontUrl}') format('woff2');
            font-weight: normal;
            font-style: normal;
        }`;
    }
    static fetchFontBuffer(url) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https:') ? https : http;
            client.get(url, (res) => {
                if ([301, 302].includes(res.statusCode) && res.headers.location) {
                    this.fetchFontBuffer(res.headers.location).then(resolve).catch(reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${url}`));
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve(new Uint8Array(Buffer.concat(chunks)));
                });
            }).on('error', reject);
        });
    }
    static glyphToRawSvg(font, unicodeHex) {
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
            if (!glyph)
                return null;
            const fontSize = 48;
            const scale = fontSize / font.unitsPerEm;
            const baselineY = font.ascender * scale;
            const path = glyph.getPath(0, baselineY, fontSize);
            const pathData = path.toPathData(2);
            const bbox = glyph.getBoundingBox();
            const xMin = bbox.x1 * scale;
            const yMin = bbox.y1 * scale;
            const xMax = bbox.x2 * scale;
            const yMax = bbox.y2 * scale;
            const width = xMax - xMin;
            const height = yMax - yMin;
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
        }
        catch (e) {
            console.error('SVG generation error:', e);
            return null;
        }
    }
    static glyphToSvgDataUri(font, unicodeHex) {
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
            if (!glyph)
                return null;
            const fontSize = 48;
            const scale = fontSize / font.unitsPerEm;
            const y = font.ascender * scale;
            const path = glyph.getPath(0, y, fontSize);
            const pathData = path.toPathData(2);
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fontSize}" height="${fontSize}" viewBox="0 0 ${fontSize + 20} ${fontSize + 20}">
  <path d="${pathData}" fill="#007ACC"/>
</svg>`;
            return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        }
        catch (err) {
            console.error('SVG generation error:', err);
            return null;
        }
    }
}
exports.FontManager = FontManager;
FontManager.fontCache = new Map();
FontManager.glyphFontCache = new Map();
//# sourceMappingURL=FontManager.js.map