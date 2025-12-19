"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIBRARY_DETECTORS = void 0;
exports.detectFontTypeForUnic = detectFontTypeForUnic;
exports.detectFontUrlName = detectFontUrlName;
const CssVersion_1 = require("../utils/CssVersion");
exports.LIBRARY_DETECTORS = [
    {
        match: css => /font\s+awesome/i.test(css),
        extract: (css, file) => {
            const faVersion = (0, CssVersion_1.detectFontAwesomeVersion)(css) ??
                (0, CssVersion_1.resolveVersion)(css, file).version;
            return {
                id: 'font-awesome',
                shortName: 'FA',
                displayName: 'Font Awesome',
                version: faVersion ?? 'unknown',
                cssPath: file,
                confidence: faVersion ? 'high' : 'low'
            };
        }
    },
    {
        match: css => /bootstrap\s+icons/i.test(css),
        extract: (css, file) => {
            const v = (0, CssVersion_1.resolveVersion)(css, file);
            return {
                id: 'bootstrap-icons',
                shortName: 'BI',
                displayName: 'Bootstrap Icons',
                version: v.version,
                cssPath: file,
                confidence: v.confidence
            };
        }
    },
    {
        match: css => /boxicons/i.test(css),
        extract: (css, file) => {
            const v = (0, CssVersion_1.resolveVersion)(css, file);
            return {
                id: 'boxicons',
                shortName: 'BX',
                displayName: 'Boxicons',
                version: v.version,
                cssPath: file,
                confidence: v.confidence
            };
        }
    }
];
function detectFontTypeForUnic(url) {
    const lower = (url || '').toLowerCase();
    if (lower.includes('solid'))
        return 'fas';
    if (lower.includes('brands'))
        return 'fab';
    if (lower.includes('regular'))
        return 'far';
    if (lower.includes('light'))
        return 'fal';
    if (lower.includes('duotone'))
        return 'fad';
    if (lower.includes('bootstrap'))
        return 'bi';
    if (lower.includes('boxicons')) {
        if (lower.includes('brands'))
            return 'bxl';
        if (lower.includes('solid'))
            return 'bxs';
        return 'bx';
    }
    return 'fa';
}
function detectFontUrlName(fullClass) {
    const lower = (fullClass || '').toLowerCase();
    if (lower.includes('fas'))
        return 'solid';
    if (lower.includes('fab'))
        return 'brands';
    if (lower.includes('far'))
        return 'regular';
    if (lower.includes('fal'))
        return 'light';
    if (lower.includes('fad'))
        return 'duotone';
    if (lower.includes('bi'))
        return 'bootstrap';
    if (lower.includes("bxl-"))
        return "brands";
    if (lower.includes("bxs-"))
        return "solid";
    if (lower.includes("bx-"))
        return "boxicons";
    return 'solid';
}
//# sourceMappingURL=library-detectors.js.map