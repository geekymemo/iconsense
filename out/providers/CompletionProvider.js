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
exports.IconCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const CssScanner_1 = require("../utils/CssScanner");
class IconCompletionProvider {
    provideCompletionItems(document, position, token, context) {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (!linePrefix.match(/class=["'][^"']*$/)) {
            return undefined;
        }
        const icons = CssScanner_1.CssScanner.getIcons();
        const completionItems = [];
        for (const icon of icons) {
            const item = new vscode.CompletionItem(icon.className, vscode.CompletionItemKind.Value);
            item.detail = `CSS Icon: ${icon.className}`;
            if (icon.cssValue) {
                const unicodeChar = String.fromCharCode(parseInt(icon.cssValue, 16));
                item.documentation = new vscode.MarkdownString(`Icon Preview: ${unicodeChar} (\\${icon.cssValue})`);
            }
            else {
                item.documentation = new vscode.MarkdownString(`Defined in ${icon.sourceFile}`);
            }
            completionItems.push(item);
        }
        return completionItems;
    }
}
exports.IconCompletionProvider = IconCompletionProvider;
//# sourceMappingURL=CompletionProvider.js.map