import type { IconDefinition } from '../types/icons';
import type { LibraryFingerprint } from '../types/css';
import * as vscode from 'vscode';

export interface TreeShakingReport {
    library: string;
    displayName: string;
    totalIcons: number;
    usedIcons: number;
    unusedIcons: number;
    usageRatio: number;
    usagePercent: number;
    severity: 'ok' | 'warn' | 'danger';
    recommendation: string;
    hint?: string;
    version?: string;
}
const config = vscode.workspace.getConfiguration('iconSense');
const showNotifications = config.get<boolean>('showNotifications', true);
export class TreeShaker {


    public static getTreeShakingReports(): TreeShakingReport[] {
        return this.treeShakingReports;
    }
    public static treeShakingReports: TreeShakingReport[] = [];

    public static detectTreeShaking(
        allIcons: IconDefinition[],
        usedClassNames: Set<string>
    ): TreeShakingReport[] {

        const byLibrary = new Map<string, IconDefinition[]>();
        const usedByLibrary = new Map<string, Set<string>>();

        // Group all icons by library
        for (const icon of allIcons) {
            const libId = icon.library?.id ?? 'unknown';

            if (!byLibrary.has(libId)) {
                byLibrary.set(libId, []);
            }
            byLibrary.get(libId)!.push(icon);
        }

        // Track used icons by library
        for (const cls of usedClassNames) {
            const icon = allIcons.find(i => i.className === cls);
            if (!icon) continue;

            const libId = icon.library?.id ?? 'unknown';

            if (!usedByLibrary.has(libId)) {
                usedByLibrary.set(libId, new Set());
            }
            usedByLibrary.get(libId)!.add(cls);
        }

        const reports: TreeShakingReport[] = [];

        for (const [libId, icons] of byLibrary.entries()) {
            const used = usedByLibrary.get(libId)?.size ?? 0;
            const total = icons.length;
            const ratio = total ? used / total : 0;
            const percent = Number((ratio * 100).toFixed(6));

            let severity: TreeShakingReport['severity'] = 'ok';
            let recommendation = 'No action needed';
            const versionsMap = this.detectMultipleVersions();

            // Versions collection for this library
            const versions = versionsMap.get(libId);
            const versionsStr = versions && versions.size > 0 ? Array.from(versions).sort().join('/') : '';

            let warning = "";
            if (versions && versions.size > 1) {
                warning = `
                   ⚠ Multiple versions detected:
                   ${Array.from(versions).join(', ')}
   
                   Recommendation:
                   • Keep only one version
                   • Remove duplicated CSS imports
                   `.trim();
            }
            if (libId === 'unknown') {
                severity = 'warn';
                recommendation = 'Unknown icon font detected';
                warning = `
               IconSense detected an icon font
               that is not yet supported.
   
               Suggestions:
               • Consider replacing with SVG icons
               • Remove unused icon font CSS
               • Open an issue to add support
               `.trim();
            }


            if (ratio < 0.03) {
                severity = 'danger';
                recommendation = 'Tree-shaking strongly recommended';
            } else if (ratio < 0.1) {
                severity = 'warn';
                recommendation = 'Tree-shaking recommended';
            }

            // take first icon as representative for library meta
            const libInfo = icons[0].library;

            // const display =
            //     libInfo?.version && libInfo.version !== 'unknown'
            //         ? `${libInfo.displayName} ${libInfo.version}`
            //         : libInfo?.displayName ?? 'Unknown library';

            // const display =  libInfo?.displayName ?? 'Unknown library' +
            //     (versionsStr ? ` (${versionsStr})` : '');
            const display = `${libInfo?.displayName ?? 'Unknown library'}${versionsStr ? ' (' + versionsStr + ')' : ''}`;

            reports.push({
                library: libInfo?.shortName ?? 'UNKNOWN',
                displayName: display,
                version: libInfo?.version,
                totalIcons: total,
                usedIcons: used,
                unusedIcons: total - used,
                usageRatio: ratio,
                usagePercent: percent,
                severity,
                recommendation,
                hint: this.getTreeShakingHint(libId, ratio) + warning
            });
        }
        this.treeShakingReports = reports;
        return reports;
    }
    private static getTreeShakingHint(lib: string, ratio: number): string | undefined {
        if (lib === 'font-awesome' && ratio < 0.1) {
            return `
                   [Tree-shaking insight]
                   You are loading multiple Font Awesome styles
                   but using very few icons.
                   
                   Suggestions:
                   • Switch to SVG icons instead of CSS icon fonts 
                   • Convert used icons to SVG and remove Font Awesome CSS
                   • Use IconSense hover → "Convert to SVG"
                   • Import only one style (solid or regular etc.)
                   • Consider icon subsetting
                   `.trim();
        }

        if (lib === 'bootstrap-icons' && ratio < 0.1) {
            return `
                   [Tree-shaking insight]
                   Bootstrap Icons are fully loaded
                   but most icons are unused.
                  
                   Suggestions:
                   • Use SVG sprite imports
                   • Convert used icons to SVG and remove icon font CSS
                   • Use IconSense hover → "Convert to SVG"
                   • Bundle only the icons you actually use
                   `.trim();
        }

        if (lib === 'boxicons' && ratio < 0.1) {
            return `
                   [Tree-shaking insight]
                   Boxicons font is mostly unused.
                  
                   Suggestions:
                   • Switch to individual SVG icons
                   • Convert used icons to SVG and remove font CSS
                   • Use IconSense hover → "Convert to SVG"
                   • Use only one boxicons variant
                   `.trim();
        }

        return undefined;
    }
    public static detectedLibraries: LibraryFingerprint[] = [];
    private static detectMultipleVersions(): Map<string, Set<string>> {
        const map = new Map<string, Set<string>>();

        for (const lib of this.detectedLibraries) {
            if (!map.has(lib.id)) map.set(lib.id, new Set());
            map.get(lib.id)!.add(lib.version);
        }

        return map;
    }
    private static formatUsagePercent(used: number, total: number): string {
        if (total === 0) return '0%';

        const percent = (used / total) * 100;

        if (percent === 0) return '0%';
        if (percent < 0.01) return '< 0.01%';
        if (percent < 1) return percent.toFixed(2) + '%';
        if (percent < 10) return percent.toFixed(1) + '%';

        return Math.round(percent) + '%';
    }
    private static output = vscode.window.createOutputChannel('IconSense');

    public static showTreeShakingNotifications(
        reports: TreeShakingReport[],
        force = false
    ) {
        const important = reports.filter(r => r.severity !== 'ok');
        if (!important.length) return;

        for (const r of important) {

            // Output’a yaz
            this.output.appendLine('────────────────────────────────────────');
            this.output.appendLine('IconSense — Tree-shaking analysis');
            this.output.appendLine('────────────────────────────────────────\n');

            this.output.appendLine(`Library        : ${r.library} (${r.displayName})`);
            this.output.appendLine(`Total icons    : ${r.totalIcons}`);
            this.output.appendLine(`Used icons     : ${r.usedIcons}`);
            this.output.appendLine(`Usage ratio    : ${this.formatUsagePercent(r.usedIcons, r.totalIcons)}\n`);

            if (r.severity === 'danger') {
                this.output.appendLine('Tree-shaking strongly recommended\n');
            }

            if (r.hint) {
                this.output.appendLine('Hint:');
                this.output.appendLine(r.hint + '\n');
            }
            const usageText =
                r.usagePercent < 1
                    ? `${this.formatUsagePercent(r.usedIcons, r.totalIcons)} of icons used`
                    : `${r.usedIcons}/${r.totalIcons} icons used`;

            const title =
                r.severity === 'danger'
                    ? `IconSense: ${r.displayName} uses only ${usageText} — huge savings possible`
                    : `IconSense: ${r.displayName} icon usage is low (${usageText})`;

            //console.log('TreeShaking showNotifications:', showNotifications);
            if (!showNotifications) {
                this.output.show(true);
                return;

            }
            if (!force) {
                this.output.show(true);
                return;
            }

            // Sadece özet notification
            vscode.window.showWarningMessage(
                title,
                'View Report',
                'Open Icon Picker',
                'Disable warnings'
            ).then(action => {

                if (action === 'View Report') {
                    this.output.show(true);
                }

                if (action === 'Open Icon Picker') {
                    vscode.commands.executeCommand('iconsense.openPicker');
                }

                if (action === 'Disable warnings') {
                    config.update(
                        'showNotifications',
                        false,
                        vscode.ConfigurationTarget.Global
                    );
                     config.update(
                        'showNotifications',
                        false,
                        vscode.ConfigurationTarget.Workspace
                    );
                }
            });
        }
    }
    public static clearCache(): void {
        this.treeShakingReports = [];
        this.detectedLibraries = [];
        console.log('TreeShaker cache cleared');
    }
}
