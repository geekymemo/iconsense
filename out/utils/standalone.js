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
const standaloneLanguages = new Set([
    'html',
    'php',
    'vue',
    'javascript',
    'typescript'
]);
class StandaloneScanner {
    static isStandaloneDocument(uri) {
        return !vscode.workspace.getWorkspaceFolder(uri);
    }
    static async scanStandaloneDocument(document) {
        if (!this.isStandaloneDocument(document.uri)) {
            return [];
        }
        if (!standaloneLanguages.has(document.languageId)) {
            return [];
        }
        const text = document.getText();
        if (!text.includes('class=') &&
            !text.includes('icon-') &&
            !text.includes('fa-') &&
            !text.includes('ti-')) {
            return [];
        }
        const icons = [];
        const cssLinks = this.extractCssLinksFromHtml(text);
        for (const link of cssLinks) {
            try {
                if (link.startsWith('http')) {
                    const css = await (0, CssFetch_1.fetchUrlCached)(link);
                    icons.push(...await CssScanner_1.CssScanner.extractIcons(css, link));
                }
                else {
                    const resolved = path.resolve(path.dirname(document.uri.fsPath), link);
                    icons.push(...await CssScanner_1.CssScanner.parseCssFile(resolved));
                }
            }
            catch (e) {
                console.warn('[Standalone CSS load failed]', link);
            }
        }
        return icons;
    }
    static extractCssLinksFromHtml(text) {
        const links = [];
        const regex = /<link[^>]+href=["']([^"']+\.css)["']/gi;
        let match;
        while ((match = regex.exec(text))) {
            links.push(match[1]);
        }
        return links;
    }
}
exports.StandaloneScanner = StandaloneScanner;
//# sourceMappingURL=standalone.js.map