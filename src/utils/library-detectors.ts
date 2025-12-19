import { LibraryDetector } from '../types/css';
import {detectFontAwesomeVersion,resolveVersion} from '../utils/CssVersion';
export const LIBRARY_DETECTORS: LibraryDetector[] = [
    {
        match: css => /font\s+awesome/i.test(css),
        extract: (css, file) => {
            const faVersion =
                detectFontAwesomeVersion(css) ??
                resolveVersion(css, file).version;

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
            const v = resolveVersion(css, file);
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
            const v = resolveVersion(css, file);
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

//prefix tahmini (gelen url üzerinden)
export function detectFontTypeForUnic(url: string): string {
        const lower = (url || '').toLowerCase();
        //console.log("url", url)
        if (lower.includes('solid')) return 'fas';
        if (lower.includes('brands')) return 'fab';
        if (lower.includes('regular')) return 'far';
        if (lower.includes('light')) return 'fal';
        if (lower.includes('duotone')) return 'fad';
        // Bootstrap
        if (lower.includes('bootstrap')) return 'bi';

        // Boxicons (URL bazlı aşamalı kontrol)
        if (lower.includes('boxicons')) {
            if (lower.includes('brands')) return 'bxl';
            if (lower.includes('solid')) return 'bxs';
            return 'bx'; // default
        }

        return 'fa';
    }
    //font dosyası tahmini(gelen fullclass üzerinden)
    export function detectFontUrlName(fullClass: string): string {
        const lower = (fullClass || '').toLowerCase();
        if (lower.includes('fas')) return 'solid';
        if (lower.includes('fab')) return 'brands';
        if (lower.includes('far')) return 'regular';
        if (lower.includes('fal')) return 'light';
        if (lower.includes('fad')) return 'duotone';
        if (lower.includes('bi')) return 'bootstrap';
        if (lower.includes("bxl-")) return "brands";
        if (lower.includes("bxs-")) return "solid";
        if (lower.includes("bx-")) return "boxicons";
        return 'solid';
    }