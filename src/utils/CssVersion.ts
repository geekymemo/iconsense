export function extractVersionFromText(text: string): string | undefined {
    const patterns = [/\bv?(\d+\.\d+\.\d+)\b/, /\bv?(\d+\.\d+)\b/];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1];
    }
    return undefined;
}

export function extractVersionFromCssComments(css: string): string | undefined {
    const commentBlock = css.slice(0, 2000);
    return extractVersionFromText(commentBlock);
}

export function extractVersionFromPath(path: string): string | undefined {
    return extractVersionFromText(path);
}

export function extractVersionFromFontFamily(css: string): string | undefined {
    const m = css.match(/font-family:\s*['"]([^'"]+)['"]/i);
    if (!m) return undefined;
    return extractVersionFromText(m[1]);
}

export function resolveVersion(css: string, file: string): { version: string; confidence: 'low' | 'medium' | 'high' } {
    const fromPath = extractVersionFromPath(file);
    if (fromPath) return { version: fromPath, confidence: 'medium' };

    const fromComment = extractVersionFromCssComments(css);
    if (fromComment) return { version: fromComment, confidence: 'high' };

    const fromFont = extractVersionFromFontFamily(css);
    if (fromFont) return { version: fromFont, confidence: 'low' };

    return { version: 'unknown', confidence: 'low' };
}

    //font awesome versiyon bul
    export function detectFontAwesomeVersion(css: string): string | undefined {
        const match =
            css.match(/Font Awesome\s+Free\s+([\d.]+)/i) ||
            css.match(/Font Awesome\s+([\d.]+)/i);

        return match?.[1];
    }


/*
static resolveVersion(css: string, file: string): { version: string; confidence: IconLibraryInfo['confidence'] } {

        const fromPath = this.extractVersionFromPath(file);
        if (fromPath) return { version: fromPath, confidence: 'medium' };

        const fromComment = this.extractVersionFromCssComments(css);
        if (fromComment) return { version: fromComment, confidence: 'high' };


        const fromFont = this.extractVersionFromFontFamily(css);
        if (fromFont) return { version: fromFont, confidence: 'low' };

        return { version: 'unknown', confidence: 'low' };
    }
   
    
*/