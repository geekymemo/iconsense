"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectIconPrefix = detectIconPrefix;
exports.detectBoxiconsFontType = detectBoxiconsFontType;
function detectIconPrefix(fullClass) {
    const parts = fullClass.split(/\s+/);
    const fa7 = ['fas', 'far', 'fal', 'fad', 'fab'];
    const fa5 = ['fa'];
    for (const p of parts) {
        const lower = p.toLowerCase();
        if (fa7.includes(lower))
            return lower;
        if (fa5.includes(lower))
            return lower;
        if (lower === 'bi')
            return 'bi';
    }
    return undefined;
}
function detectBoxiconsFontType(cssPath, className) {
    const p = cssPath.toLowerCase();
    if (p.includes('brands'))
        return 'bxl';
    if (p.includes('solid'))
        return 'bxs';
    if (className) {
        if (className.startsWith('bxl-'))
            return 'bxl';
        if (className.startsWith('bxs-'))
            return 'bxs';
        if (className.startsWith('bx-'))
            return 'bx';
    }
    return 'bx';
}
//# sourceMappingURL=IconPrefix.js.map