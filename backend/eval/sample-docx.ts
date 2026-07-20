/**
 * 評価用サンプル文書の docx 生成（EVAL-001）。
 * ①原本として同梱するため、外部ツールなしで最小構成の有効な OOXML（Word文書）を組み立てる。
 * 抽出は行わない（②はシード時に構造 JSON を直接保存する）ため、見出し・段落だけの簡易文書とする。
 */
import AdmZip from 'adm-zip'

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function paragraphXml(text: string, headingLevel?: number): string {
  const style = headingLevel ? `<w:pPr><w:pStyle w:val="Heading${headingLevel}"/></w:pPr>` : ''
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`

export interface DocxBlock {
  heading?: string
  text?: string
}

/** 見出し・段落ブロック列から docx バイナリを生成する */
export function buildDocx(title: string, blocks: DocxBlock[]): Buffer {
  const body = [
    paragraphXml(title, 1),
    ...blocks.map((block) => (block.heading ? paragraphXml(block.heading, 2) : paragraphXml(block.text ?? '')))
  ].join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr/></w:body>
</w:document>`

  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES, 'utf-8'))
  zip.addFile('_rels/.rels', Buffer.from(ROOT_RELS, 'utf-8'))
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(DOCUMENT_RELS, 'utf-8'))
  zip.addFile('word/styles.xml', Buffer.from(STYLES, 'utf-8'))
  zip.addFile('word/document.xml', Buffer.from(document, 'utf-8'))
  return zip.toBuffer()
}
