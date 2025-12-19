export type LibraryDetector = {
    match: (css: string, file: string) => boolean;
    extract: (css: string, file: string) => IconLibraryInfo;
};

export type LibraryFingerprint = {
    id: string;
    version: string;
    cssPath: string;
};
export interface IconLibraryInfo {
    id: string;            // 'font-awesome', 'bootstrap-icons', 'boxicons'
    shortName: string;     // FA, BI, BX
    displayName: string;   // Font Awesome, Bootstrap Icons
    version: string | 'unknown';      // 6.5.1
    cssPath: string;       // local path veya CDN url
    confidence: 'high' | 'medium' | 'low';
}
