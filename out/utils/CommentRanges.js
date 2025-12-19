"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommentRanges = getCommentRanges;
exports.isInsideComment = isInsideComment;
async function getCommentRanges(content) {
    const ranges = [];
    const patterns = [
        /\/\*[\s\S]*?\*\//g,
        /\/\/.*$/gm,
        /<!--[\s\S]*?-->/g
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
function isInsideComment(index, ranges) {
    return ranges.some(r => index >= r.start && index < r.end);
}
//# sourceMappingURL=CommentRanges.js.map