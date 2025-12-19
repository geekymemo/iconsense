export function detectIconPrefix(fullClass: string): string | undefined {
    const parts = fullClass.split(/\s+/);
    const fa7 = ['fas', 'far', 'fal', 'fad', 'fab'];
    const fa5 = ['fa'];

    for (const p of parts) {
        const lower = p.toLowerCase();
        if (fa7.includes(lower)) return lower;
        if (fa5.includes(lower)) return lower;
        if (lower === 'bi') return 'bi';
        // if (lower.startsWith('bxl')) return 'bxl';
        // if (lower.startsWith('bxs')) return 'bxs';
        // if (lower.startsWith('bx')) return 'bx';
    }
    return undefined;
}
export function detectBoxiconsFontType(cssPath: string, className?: string): 'bx' | 'bxs' | 'bxl' {
    const p = cssPath.toLowerCase();
    // 1. Öncelik: URL’den belirle
    if (p.includes('brands')) return 'bxl';
    if (p.includes('solid')) return 'bxs';

    // 2. URL’den çözemediysek className’e bak
    if (className) {
        if (className.startsWith('bxl-')) return 'bxl';
        if (className.startsWith('bxs-')) return 'bxs';
        if (className.startsWith('bx-')) return 'bx';
    }

    // Default
    return 'bx';
}
/*
   private static detectIconPrefix(fullClass: string): string | undefined {
        const parts = fullClass.split(/\s+/);
        // Font Awesome 7
        const fa7 = ['fas', 'far', 'fal', 'fad', 'fab'];
        const fa5 = ['fa'];

        for (const p of parts) {
            const lower = p.toLowerCase();
            if (fa7.includes(lower)) return lower;
            if (fa5.includes(lower)) return lower;
            if (lower === 'bi') return 'bi';          // Bootstrap Icons
            if (lower.startsWith('bxl')) return 'bxl'; // boxicons-logo
            if (lower.startsWith('bxs')) return 'bxs'; // boxicons-solid
            if (lower.startsWith('bx')) return 'bx';   // boxicons-regular / default
        }
        return undefined;
    }
*/