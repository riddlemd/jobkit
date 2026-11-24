// Run: node --test tests/
// Unit tests for the in-process DOCX writer (scripts/lib/docx.mjs). The zip reader here is
// independent of the writer, so a broken archive fails instead of round-tripping its own bug.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { docxFromResume } from "../scripts/lib/docx.mjs";

// Own CRC-32 so a broken writer checksum can't be masked by sharing its implementation.
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}

function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end-of-central-directory record missing");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "bad central directory entry");
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, `bad local header for ${name}`);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, usize, `size mismatch for ${name}`);
    assert.equal(crc32(data), crc, `crc mismatch for ${name}`);
    files[name] = data.toString("utf8");
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

// Visible text of document.xml, paragraph by paragraph.
const paragraphsOf = xml => [...xml.matchAll(/<w:p>(.*?)<\/w:p>/g)]
  .map(m => [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)].map(t => t[1] ?? "\t").join(""));

const sampleDoc = () => ({
  name: "Jane Doe",
  subtitle: "Senior Software Engineer",
  sections: [
    { title: "Contact", lines: ["- **Email:** jane@example.com", "- **GitHub:** [github.com/jane](https://github.com/jane)"] },
    { title: "Summary", lines: ["Builds **reliable** APIs.", "", "Second paragraph."] },
    { title: "Work Experience", lines: [
      "### Senior Engineer — Acme Corp",
      "*Jan 2020 - Present*",
      "- Shipped the v2 API",
      "- Cut deploy time in half",
    ] },
    { title: "Skills", lines: ["**Languages:** C#, TypeScript", "**Cloud:** Azure, AWS"] },
  ],
});

test("Given a resume, When it is written as DOCX, Then the archive holds every part Word needs with valid checksums", () => {
  // Given
  const doc = sampleDoc();
  // When
  const files = unzip(docxFromResume(doc));
  // Then
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml",
    "word/numbering.xml", "word/_rels/document.xml.rels"]) assert.ok(part in files, `missing ${part}`);
  assert.match(files["[Content_Types].xml"], /PartName="\/word\/document.xml"/);
  assert.match(files["_rels/.rels"], /Target="word\/document.xml"/);
});

test("Given a resume, When it is written as DOCX, Then its text appears in reading order with the date tabbed onto the role line", () => {
  // Given
  const doc = sampleDoc();
  // When
  const paras = paragraphsOf(unzip(docxFromResume(doc))["word/document.xml"]);
  // Then
  assert.deepEqual(paras, [
    "Jane Doe",
    "Senior Software Engineer",
    "jane@example.com  |  github.com/jane",
    "SUMMARY",
    "Builds reliable APIs.",
    "Second paragraph.",
    "WORK EXPERIENCE",
    "Senior Engineer  |  Acme Corp\tJan 2020 - Present",
    "Shipped the v2 API",
    "Cut deploy time in half",
    "SKILLS",
    "Languages: C#, TypeScript",
    "Cloud: Azure, AWS",
  ]);
});

test("Given a resume, When it is written as DOCX, Then the layout is ATS-clean with no tables, columns or text boxes", () => {
  // Given
  const doc = sampleDoc();
  // When
  const xml = unzip(docxFromResume(doc))["word/document.xml"];
  // Then
  assert.doesNotMatch(xml, /<w:tbl[ >]|<w:cols |<w:txbxContent|<v:textbox/);
});

test("Given experience bullets, When written as DOCX, Then each bullet is a numbered-list paragraph", () => {
  // Given
  const doc = sampleDoc();
  // When
  const xml = unzip(docxFromResume(doc))["word/document.xml"];
  // Then
  const bulletParas = [...xml.matchAll(/<w:p>(.*?)<\/w:p>/g)].filter(m => m[1].includes('<w:numId w:val="1"/>'));
  assert.equal(bulletParas.length, 2);
  assert.match(bulletParas[0][1], /Shipped the v2 API/);
});

test("Given a markdown link, When written as DOCX, Then it becomes an external hyperlink to that URL", () => {
  // Given
  const doc = sampleDoc();
  // When
  const files = unzip(docxFromResume(doc));
  // Then
  const id = files["word/document.xml"].match(/<w:hyperlink r:id="([^"]+)">.*?github\.com\/jane<\/w:t>/)?.[1];
  assert.ok(id, "hyperlink run missing");
  assert.match(files["word/_rels/document.xml.rels"],
    new RegExp(`Id="${id}"[^>]*Target="https://github.com/jane" TargetMode="External"`));
});

test("Given bold markdown, When written as DOCX, Then the bold words are in a bold run", () => {
  // Given
  const doc = sampleDoc();
  // When
  const xml = unzip(docxFromResume(doc))["word/document.xml"];
  // Then
  const runOf = word => xml.match(new RegExp(`<w:r>(?:(?!</w:r>).)*>${word}</w:t></w:r>`))?.[0];
  assert.match(runOf("reliable") ?? "", /<w:b\/>/);
  for (const plain of ["Builds ", " APIs\\."]) assert.doesNotMatch(runOf(plain) ?? "<w:b/>", /<w:b\/>/);
  assert.doesNotMatch(xml, /\*\*/);
});

test("Given text with XML-special characters, When written as DOCX, Then they are escaped and the XML stays well-formed", () => {
  // Given
  const doc = { name: "A & B <Co>", subtitle: "", sections: [{ title: "Summary", lines: ['Uses "R&D" <tools>'] }] };
  // When
  const xml = unzip(docxFromResume(doc))["word/document.xml"];
  // Then
  assert.match(xml, /A &amp; B &lt;Co&gt;/);
  assert.match(xml, /Uses &quot;R&amp;D&quot; &lt;tools&gt;/);
  assert.doesNotMatch(xml, /& |<Co>|<tools>/);
});

test("Given a sanitizer, When written as DOCX, Then visible text passes through it but link URLs do not", () => {
  // Given
  const doc = sampleDoc();
  const sanitize = s => s.replace(/a/g, "4");
  // When
  const files = unzip(docxFromResume(doc, sanitize));
  // Then
  assert.match(files["word/document.xml"], />J4ne Doe</);
  assert.match(files["word/_rels/document.xml.rels"], /Target="https:\/\/github.com\/jane"/);
});
