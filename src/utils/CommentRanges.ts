export async function getCommentRanges(content: string) {
    const ranges: { start: number; end: number }[] = [];

    const patterns = [
        /\/\*[\s\S]*?\*\//g,   // block comment
        /\/\/.*$/gm,           // line comment
        /<!--[\s\S]*?-->/g     // html comment
    ];

    for (const regex of patterns) {
        let m;
        while ((m = regex.exec(content))) {
            ranges.push({
                start: m.index,
                end: m.index + m[0].length
            });
        }
    }

    return ranges;
}
export function isInsideComment(
    index: number,
    ranges: { start: number; end: number }[]
) {
    return ranges.some(r => index >= r.start && index < r.end);
}