// Line-level merge for WYSIWYG saves: lines the edit didn't change keep their original bytes
// despite the serializer's normalizations. Shared with frontmatter writes, so it lives in the parser.
export { linesCorrespond, mergeEditedLines as mergeEdited } from '@slidev/parser/utils'
