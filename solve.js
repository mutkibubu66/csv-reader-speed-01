// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answers as csv-reader's readCsv for every {text, header}, faster:
// the text is read once, left to right, but fields are cut with native
// indexOf scans instead of one character at a time, and field values are
// slices of the input, joined only when a quoted field really holds
// several pieces. Every scan is bounded by its field: an unquoted field
// is bounded by its next comma or LF (its own slice is checked for a CR),
// a quoted field by its next quote (its own slice is checked for a line
// break), and only fields that actually hold a CR or a line break inside
// quotes fall back to a delimiter scan.
//
// Policy (csv-reader 1.0.0, as the kit's reference states it):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next non-doubled quote, "" is
//   one quote, CRLF / lone CR inside quotes read as LF; text after the
//   closing quote up to the next comma or line break is appended as it
//   stands (quote_junk, when the field ends); a quote that never closes is
//   literal and the text after it is re-read as unquoted
//   (unterminated_quote).
// - A quote inside an unquoted field is literal. Fields stay strings,
//   never trimmed or converted.
// - columns is the first record when header is true, else null; rows are
//   padded with "" (short_row, fields: its count) or cut (long_row, extra:
//   the cut fields) to the first record's width.
// - Each error is {code, line, row} in the order met; line is the 1-based
//   line the record starts on (counting every LF, CRLF and lone CR inside
//   quotes), row the record's index in rows (null for the header).

// Next field delimiter outside quotes: comma, CR or LF. Global (not
// sticky): exec searches forward from lastIndex and stops at the next one.
const DELIM = /[,\r\n]/g;
// Next interesting character inside quotes: quote, CR or LF.
const QDELIM = /["\r\n]/g;

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and its index in rows
  // (null while the header is still unread). Every error reports these.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break; a CR not followed by LF is dropped (stray_cr). Returns the
  // field, how it ended, and how many characters were kept (`added`).
  // Fast path: the next comma / LF bound the field, and the field's own
  // slice is checked for a CR, so no scan ever runs past the field.
  // Anything holding a CR falls back to the delimiter scan below.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      let end = -1;
      let kind = 0;
      if (comma !== -1) { end = comma; kind = 44; }
      if (lf !== -1 && (end === -1 || lf < end)) { end = lf; kind = 10; }
      if (end !== -1) {
        let v;
        if (kind === 10 && text.charCodeAt(end - 1) === 13) {
          v = text.slice(pos, end - 1);
          if (v.indexOf('\r') === -1) {
            value += v;
            added += v.length;
            pos = end + 1;
            line += 1;
            return { value, ended: LINE_BREAK, added };
          }
        } else {
          v = text.slice(pos, end);
          if (v.indexOf('\r') === -1) {
            value += v;
            added += v.length;
            if (kind === 44) {
              pos = end + 1;
              return { value, ended: COMMA, added };
            }
            pos = end + 1;
            line += 1;
            return { value, ended: LINE_BREAK, added };
          }
        }
      }
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        if (pos < n) {
          value += text.slice(pos);
          added += n - pos;
        }
        pos = n;
        return { value, ended: END, added };
      }
      const end2 = m.index;
      const code = text.charCodeAt(end2);
      if (code === 13) {
        if (text.charCodeAt(end2 + 1) === 10) {
          value += text.slice(pos, end2);
          added += end2 - pos;
          pos = end2 + 2;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        // A lone CR outside quotes: dropped, and the field goes on.
        value += text.slice(pos, end2);
        added += end2 - pos;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = end2 + 1;
        continue;
      }
      value += text.slice(pos, end2);
      added += end2 - pos;
      if (code === 44) {
        pos = end2 + 1;
        return { value, ended: COMMA, added };
      }
      pos = end2 + 1;
      line += 1;
      return { value, ended: LINE_BREAK, added };
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  // Fast path: the next quote closes the field (or is doubled) and no
  // line break sits before it, so the field is one slice. Anything with
  // a line break inside falls through to the delimiter scan below.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let parts = null;

    // What follows a closing quote: end of text, comma, line break, or
    // junk appended as it stands up to the next comma or line break.
    function afterClose(value) {
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      const junk = readUnquoted(value);
      if (junk.added > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return junk;
    }

    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) break;
      const seg = text.slice(pos, q);
      if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
        if (text.charCodeAt(q + 1) === 34) {
          // A doubled quote is one quote inside the field.
          if (parts === null) parts = [];
          parts.push(seg, '"');
          pos = q + 2;
          continue;
        }
        // The closing quote.
        const value = parts === null ? seg : parts.join('') + seg;
        pos = q + 1;
        return afterClose(value);
      }
      // A line break sits before the next quote: one delimiter step.
      QDELIM.lastIndex = pos;
      const m = QDELIM.exec(text);
      if (m === null) break;
      const end = m.index;
      const code = text.charCodeAt(end);
      if (code === 34) {
        if (text.charCodeAt(end + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(pos, end), '"');
          pos = end + 2;
          continue;
        }
        const value = parts === null ? text.slice(pos, end) : parts.join('') + text.slice(pos, end);
        pos = end + 1;
        return afterClose(value);
      }
      // CRLF and a lone CR inside quotes are each one LF.
      if (parts === null) parts = [];
      parts.push(text.slice(pos, end), '\n');
      line += 1;
      pos = code === 10 ? end + 1 : end + (text.charCodeAt(end + 1) === 10 ? 2 : 1);
    }
    // The quote never closes: it is a literal character, and the text
    // after it is read again as unquoted.
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    return readUnquoted('"');
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
