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
exports.StandaloneScanner = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const CssFetch_1 = require("./CssFetch");
const CssScanner_1 = require("./CssScanner");
const CommentRanges_1 = require("./CommentRanges");
const standaloneLanguages = new Set(['html', 'php']);
class StandaloneScanner {
    static async scanStandaloneDocument(document) {
        const uri = document.uri.toString();
        if (this.activeUri === uri) {
            return this.activeIcons;
        }
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
        const icons = [];
        const commentRanges = await (0, CommentRanges_1.getCommentRanges)(text);
        const cssLinks = this.extractCssLinksFromHtml(text, commentRanges);
        for (const link of await cssLinks) {
            try {
                if (link.startsWith('http')) {
                    const css = await (0, CssFetch_1.fetchUrlCached)(link);
                    icons.push(...(await CssScanner_1.CssScanner.extractIcons(css, link)));
                }
                else {
                    const resolved = path.resolve(path.dirname(document.uri.fsPath), link);
                    icons.push(...(await CssScanner_1.CssScanner.parseCssFile(resolved)));
                }
            }
            catch {
                console.warn('[Standalone CSS load failed]', link);
            }
        }
        this.activeIcons = icons;
        this.activeUri = document.uri.toString();
        this._active = icons.length > 0;
        return icons;
    }
    static isSameDocument(document) {
        return this.activeUri === document.uri.toString();
    }
    static hasActiveStandaloneIcons() {
        return this._active && this.activeIcons.length > 0;
    }
    static getIcons() {
        return this.activeIcons;
    }
    static isStandaloneDocument(uri) {
        return !vscode.workspace.getWorkspaceFolder(uri);
    }
    static extractCssLinksFromHtml(text, commentRanges) {
        const links = [];
        const regex = /<link[^>]+href=["']([^"']+\.css)["']/gi;
        let match;
        while ((match = regex.exec(text))) {
            const index = match.index;
            const isInComment = commentRanges.some((r) => index >= r.start && index <= r.end);
            if (isInComment)
                continue;
            links.push(match[1]);
        }
        return links;
    }
    static clear() {
        this.activeIcons = [];
        this.activeUri = null;
        this._active = false;
    }
}
exports.StandaloneScanner = StandaloneScanner;
StandaloneScanner.activeIcons = [];
StandaloneScanner.activeUri = null;
StandaloneScanner._active = false;
//# sourceMappingURL=StandaloneScanner.js.map