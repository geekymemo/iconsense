"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractVersionFromText = extractVersionFromText;
exports.extractVersionFromCssComments = extractVersionFromCssComments;
exports.extractVersionFromPath = extractVersionFromPath;
exports.extractVersionFromFontFamily = extractVersionFromFontFamily;
exports.resolveVersion = resolveVersion;
exports.detectFontAwesomeVersion = detectFontAwesomeVersion;
function extractVersionFromText(text) {
    const patterns = [/\bv?(\d+\.\d+\.\d+)\b/, /\bv?(\d+\.\d+)\b/];
    for (const p of patterns) {
        const m = text.match(p);
        if (m)
            return m[1];
    }
    return undefined;
}
function extractVersionFromCssComments(css) {
    const commentBlock = css.slice(0, 2000);
    return extractVersionFromText(commentBlock);
}
function extractVersionFromPath(path) {
    return extractVersionFromText(path);
}
function extractVersionFromFontFamily(css) {
    const m = css.match(/font-family:\s*['"]([^'"]+)['"]/i);
    if (!m)
        return undefined;
    return extractVersionFromText(m[1]);
}
function resolveVersion(css, file) {
    const fromPath = extractVersionFromPath(file);
    if (fromPath)
        return { version: fromPath, confidence: 'medium' };
    const fromComment = extractVersionFromCssComments(css);
    if (fromComment)
        return { version: fromComment, confidence: 'high' };
    const fromFont = extractVersionFromFontFamily(css);
    if (fromFont)
        return { version: fromFont, confidence: 'low' };
    return { version: 'unknown', confidence: 'low' };
}
function detectFontAwesomeVersion(css) {
    const match = css.match(/Font Awesome\s+Free\s+([\d.]+)/i) ||
        css.match(/Font Awesome\s+([\d.]+)/i);
    return match?.[1];
}
//# sourceMappingURL=CssVersion.js.map