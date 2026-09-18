const MAX_TEXT_BYTES = 192 * 1024;
const UTF8 = new TextEncoder();

function assertText(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}_invalid`);
  if (UTF8.encode(value).byteLength > MAX_TEXT_BYTES) throw new Error(`${label}_too_large`);
  return value;
}

function splitSafePrefix(a, b) {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  if (
    index > 0
    && index < a.length
    && index < b.length
    && /[\uD800-\uDBFF]/.test(a[index - 1])
    && /[\uDC00-\uDFFF]/.test(a[index])
  ) index -= 1;
  return index;
}

function splitSafeSuffix(a, b, prefix) {
  const max = Math.min(a.length, b.length) - prefix;
  let suffix = 0;
  while (
    suffix < max
    && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) suffix += 1;
  const aIndex = a.length - suffix;
  const bIndex = b.length - suffix;
  if (
    suffix > 0
    && aIndex > prefix
    && bIndex > prefix
    && /[\uD800-\uDBFF]/.test(a[aIndex - 1])
    && /[\uDC00-\uDFFF]/.test(a[aIndex])
  ) suffix -= 1;
  return suffix;
}

function pointAtUtf16(text, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index > text.length) {
    throw new Error('tree_sitter_edit_index_invalid');
  }
  let row = 0;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      row += 1;
      lineStart = i + 1;
    }
  }
  return Object.freeze({ row, column: index - lineStart });
}

export function minimalWebTreeSitterEdit(oldValue, newValue) {
  const oldText = assertText(oldValue, 'tree_sitter_old_text');
  const newText = assertText(newValue, 'tree_sitter_new_text');
  if (oldText === newText) return null;

  const prefix = splitSafePrefix(oldText, newText);
  const suffix = splitSafeSuffix(oldText, newText, prefix);
  const oldEnd = oldText.length - suffix;
  const newEnd = newText.length - suffix;

  return Object.freeze({
    startIndex: prefix,
    oldEndIndex: oldEnd,
    newEndIndex: newEnd,
    startPosition: pointAtUtf16(oldText, prefix),
    oldEndPosition: pointAtUtf16(oldText, oldEnd),
    newEndPosition: pointAtUtf16(newText, newEnd),
  });
}

export const DEVOS_TREE_SITTER_EDIT_CONTRACT = Object.freeze({
  schema: 'metaengine.devos.ide.tree-sitter-edit.v1',
  index_units: 'JAVASCRIPT_UTF16_CODE_UNITS',
  point_column_units: 'JAVASCRIPT_UTF16_CODE_UNITS',
  max_text_bytes: MAX_TEXT_BYTES,
  surrogate_split_allowed: false,
  authority_effect: false,
  automatic_retry_allowed: false,
});
