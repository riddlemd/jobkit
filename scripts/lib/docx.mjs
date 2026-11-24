// docx.mjs - build the resume .docx directly (WordprocessingML in a zip), no Office app needed.
// Layout stays ATS-clean: single column, real paragraphs and bullets, no tables, columns or
// text boxes. Job dates sit on the role line via a right tab stop instead of a table cell.

import { deflateRawSync } from "node:zlib";

const NAVY = "15365C", NAVY_SOFT = "36608F", INK = "2A3540", MUTED = "737F8B";
const PAGE_W = 12240, MARGIN = 1080;               // Letter, 0.75in margins (twips)
const TEXT_W = PAGE_W - 2 * MARGIN;

const xmlEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- runs and paragraphs ----
function run(text, { bold, color, size, italic } = {}) {
  const pr = [bold ? "<w:b/>" : "", italic ? "<w:i/>" : "", color ? `<w:color w:val="${color}"/>` : "",
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ""].join("");
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}
const tab = () => "<w:r><w:tab/></w:r>";

function para(runs, { style, spacingBefore, spacingAfter, tabs, keepNext, numbered, shade } = {}) {
  const pr = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    keepNext ? "<w:keepNext/>" : "",
    numbered ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` : "",
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : "",
    tabs ? `<w:tabs>${tabs.map(t => `<w:tab w:val="${t.val}" w:pos="${t.pos}"/>`).join("")}</w:tabs>` : "",
    spacingBefore != null || spacingAfter != null
      ? `<w:spacing${spacingBefore != null ? ` w:before="${spacingBefore}"` : ""}${spacingAfter != null ? ` w:after="${spacingAfter}"` : ""}/>` : "",
  ].join("");
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ""}${runs.join("")}</w:p>`;
}

// ---- builder: collects body paragraphs plus hyperlink relationships ----
export function docxFromResume(doc, sanitize = s => s) {
  const links = [];                                   // [{ id, url }]
  const linkId = url => {
    let l = links.find(x => x.url === url);
    if (!l) { l = { id: `rIdL${links.length + 1}`, url }; links.push(l); }
    return l.id;
  };

  // inline markdown -> runs: **bold** and [text](url); visible text is sanitized, URLs are not
  const inline = (s, base = {}) => {
    const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
    const out = [];
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(run(sanitize(s.slice(last, m.index)), base));
      if (m[1] !== undefined) {
        out.push(`<w:hyperlink r:id="${linkId(m[2])}">${run(sanitize(m[1]), { ...base, color: NAVY_SOFT })
          .replace("<w:rPr>", '<w:rPr><w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`);
      } else out.push(run(sanitize(m[3]), { ...base, bold: true, color: NAVY }));
      last = re.lastIndex;
    }
    if (last < s.length) out.push(run(sanitize(s.slice(last)), base));
    return out;
  };

  const body = [];
  const paragraphs = ls => ls.join("\n").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const bullets = ls => ls.map(l => l.trim().match(/^-\s+(.+)$/)).filter(Boolean)
    .forEach(m => body.push(para(inline(m[1].trim()), { numbered: true, spacingAfter: 60 })));

  body.push(para([run(sanitize(doc.name), { bold: true, color: NAVY, size: 44 })], { style: "Title", spacingAfter: 40 }));
  if (doc.subtitle) body.push(para([run(sanitize(doc.subtitle), { color: NAVY_SOFT, size: 22 })], { spacingAfter: 80 }));

  for (const sec of doc.sections) {
    const t = sec.title;
    if (/^contact$/i.test(t)) {
      const items = sec.lines.map(l => l.match(/^-\s+\*\*([^:]+):\*\*\s*(.+)$/)).filter(Boolean).map(m => m[2].trim());
      const runs = [];
      items.forEach((it, i) => { if (i) runs.push(run("  |  ", { color: MUTED })); runs.push(...inline(it, { size: 19, color: NAVY })); });
      body.push(para(runs, { spacingAfter: 120 }));
      continue;
    }
    body.push(para([run(sanitize(t).toUpperCase(), { bold: true, color: NAVY, size: 21 })], { style: "Heading1", keepNext: true }));

    if (/^summary$/i.test(t)) {
      paragraphs(sec.lines).forEach(p => body.push(para(inline(p))));
    } else if (/^core competencies$/i.test(t)) {
      const p = paragraphs(sec.lines)[0] || "";
      body.push(para([run(p.split(/\s*[·|]\s*/).map(s => sanitize(s.trim())).filter(Boolean).join(" | "))]));
    } else if (/work experience|experience/i.test(t)) {
      const blocks = sec.lines.join("\n").split(/^###\s+/m).map(s => s.trim()).filter(Boolean);
      for (const b of blocks) {
        const bl = b.split(/\r?\n/);
        const head = bl.shift().trim();
        const hm = head.match(/^(.*?) [—–-] (.+)$/);
        const role = hm ? hm[1].trim() : head, company = hm ? hm[2].trim() : "";
        let date = "";
        const items = [];
        for (const l of bl) {
          const s = l.trim();
          if (!s) continue;
          const dm = s.match(/^\*(.+)\*$/);
          if (dm && !date) { date = dm[1].trim(); continue; }
          if (/^-\s+/.test(s)) items.push(s);
        }
        const runs = [run(sanitize(role), { bold: true, color: INK, size: 22 })];
        if (company) runs.push(run("  |  ", { color: MUTED }), run(sanitize(company), { color: NAVY_SOFT }));
        if (date) runs.push(tab(), run(sanitize(date), { color: MUTED, size: 18 }));
        body.push(para(runs, { keepNext: true, spacingBefore: 160, spacingAfter: 60, tabs: [{ val: "right", pos: TEXT_W }] }));
        bullets(items);
      }
    } else if (/^skills$/i.test(t)) {
      let i = 0;
      for (const l of sec.lines) {
        const m = l.trim().match(/^\*\*([^*]+)\*\*\s*(.*)$/);
        if (!m) continue;
        body.push(para([run(sanitize(m[1].trim()), { bold: true, color: NAVY }), run(" "), ...inline(m[2].trim())],
          { spacingAfter: 60, shade: i++ % 2 ? "F4F7FB" : undefined }));
      }
    } else if (sec.lines.some(l => /^\s*-\s+/.test(l))) {
      bullets(sec.lines);
    } else {
      paragraphs(sec.lines).forEach(p => body.push(para(inline(p))));
    }
  }

  return zip([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", ROOT_RELS],
    ["word/document.xml", documentXml(body.join(""))],
    ["word/styles.xml", STYLES],
    ["word/numbering.xml", NUMBERING],
    ["word/_rels/document.xml.rels", documentRels(links)],
  ]);
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const documentXml = body => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="15840"/>` +
  `<w:pgMar w:top="1008" w:right="${MARGIN}" w:bottom="1008" w:left="${MARGIN}" w:header="720" w:footer="720" w:gutter="0"/>` +
  `</w:sectPr></w:body></w:document>`;

const documentRels = links => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
  links.map(l => `<Relationship Id="${l.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ` +
    `Target="${xmlEsc(l.url)}" TargetMode="External"/>`).join("") + `</Relationships>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
  `</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>` +
  `<w:color w:val="${INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/>` +
  `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="E3E8EE"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr></w:style>` +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>` +
  `</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>` +
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:lvlJc w:val="left"/>` +
  `<w:pPr><w:ind w:left="360" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

// ---- minimal zip writer (deflate) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(0x00210000, 10);   // deflate; fixed 1980-01-01 timestamp
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
