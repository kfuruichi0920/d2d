/**
 * 抽出文書のリッチプレビュー（P5-18、EXT-048）。
 * ワーカーが保持した書式・Story・描画要素を、形式非依存の任意フィールドとして表示へ投影する。
 */
import type { CSSProperties } from 'react'

export interface DirectRunFormat {
  bold?: boolean
  italic?: boolean
  underline?: string
  strike?: boolean
  double_strike?: boolean
  color?: string
  highlight?: string
  shading?: string
  font_size_half_points?: string
  font_ascii?: string
  font_east_asia?: string
  vertical_align?: string
  hidden?: boolean
  character_spacing?: string
}

export interface RichTextRun {
  text: string
  format?: { direct?: DirectRunFormat; effective?: DirectRunFormat }
  breaks?: string[]
  tab_count?: number
}

export interface PreviewField {
  instruction?: string | null
  cached_result?: string | null
}

export interface RichPreviewElement {
  id: string
  type: string
  text?: string
  runs?: RichTextRun[]
  fields?: PreviewField[]
  story_type?: string
  list_info?: {
    kind?: string
    level?: number
    level_text?: string
    start?: number
    number_format?: string
  } | null
  shape_type?: string
  name?: string | null
  parent_uid?: string | null
  text_body?: { paragraphs?: RichPreviewElement[] }
  position?: Record<string, unknown> | null
  size?: Record<string, unknown> | null
  z_order?: number | null
  start_native_id?: string | null
  end_native_id?: string | null
  begin_arrow?: string | null
  end_arrow?: string | null
}

export interface PreviewStory {
  story_type: string
  source_part?: string
  elements: RichPreviewElement[]
}

export interface PreviewComment {
  comment_id?: string
  author?: string
  date?: string
  text?: string
}

export interface PreviewRevision {
  revision_id?: string
  type?: string
  author?: string
  date?: string
  text?: string
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#fff59d',
  green: '#a5d6a7',
  cyan: '#80deea',
  magenta: '#f48fb1',
  blue: '#90caf9',
  red: '#ef9a9a',
  darkBlue: '#5c6bc0',
  darkCyan: '#4db6ac',
  darkGreen: '#66bb6a',
  darkMagenta: '#ab47bc',
  darkRed: '#e57373',
  darkYellow: '#ffd54f',
  darkGray: '#9e9e9e',
  lightGray: '#e0e0e0',
  black: '#212121',
  white: '#ffffff'
}

function hexColor(value: string | undefined): string | undefined {
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : undefined
}

/** OOXMLの直接書式を安全なCSSへ変換する。未指定値は既定表示へ介入しない。 */
export function styleFromRunFormat(format: DirectRunFormat | undefined): CSSProperties {
  if (!format) return {}
  const lines: string[] = []
  if (format.underline && format.underline !== 'none') lines.push('underline')
  if (format.strike || format.double_strike) lines.push('line-through')
  const halfPoints = Number(format.font_size_half_points)
  const spacing = Number(format.character_spacing)
  return {
    fontWeight: format.bold ? 700 : undefined,
    fontStyle: format.italic ? 'italic' : undefined,
    textDecorationLine: lines.length > 0 ? lines.join(' ') : undefined,
    textDecorationStyle:
      format.double_strike || format.underline === 'double'
        ? 'double'
        : format.underline === 'dotted'
          ? 'dotted'
          : format.underline === 'dash'
            ? 'dashed'
            : undefined,
    color: hexColor(format.color),
    backgroundColor:
      format.highlight && format.highlight !== 'none' ? HIGHLIGHT_COLORS[format.highlight] : hexColor(format.shading),
    fontFamily: format.font_east_asia ?? format.font_ascii,
    fontSize: Number.isFinite(halfPoints) && halfPoints > 0 ? `${halfPoints / 2}pt` : undefined,
    verticalAlign:
      format.vertical_align === 'superscript' ? 'super' : format.vertical_align === 'subscript' ? 'sub' : undefined,
    letterSpacing: Number.isFinite(spacing) && spacing !== 0 ? `${spacing / 20}pt` : undefined,
    opacity: format.hidden ? 0.45 : undefined,
    outline: format.hidden ? '1px dotted var(--d2d-fg-muted)' : undefined
  }
}

export function RichText({ text, runs }: { text?: string; runs?: RichTextRun[] }): React.JSX.Element {
  if (!runs || runs.length === 0) return <>{text ?? ''}</>
  return (
    <>
      {runs.map((run, index) => (
        <span
          key={`${index}-${run.text}`}
          style={styleFromRunFormat(run.format?.effective ?? run.format?.direct)}
          title={run.format?.direct?.hidden ? 'Wordで非表示文字として保存' : undefined}
          data-testid="rich-text-run"
        >
          {run.text}
          {'\t'.repeat(run.tab_count ?? 0)}
          {(run.breaks ?? []).map((_, breakIndex) => (
            <br key={breakIndex} />
          ))}
        </span>
      ))}
    </>
  )
}

export function FieldBadges({ fields }: { fields?: PreviewField[] }): React.JSX.Element | null {
  if (!fields || fields.length === 0) return null
  return (
    <span style={{ marginLeft: 6 }}>
      {fields.map((field, index) => (
        <span
          key={`${field.instruction}-${index}`}
          className="d2d-badge"
          title={`Wordフィールド: ${field.instruction?.trim() || '命令なし'}`}
          data-testid="word-field"
        >
          {field.instruction?.trim() || 'FIELD'}: {field.cached_result || '（結果なし）'}
        </span>
      ))}
    </span>
  )
}

function shapeDetail(element: RichPreviewElement): string {
  const details = [
    element.name,
    element.shape_type,
    element.position ? `位置 ${JSON.stringify(element.position)}` : null,
    element.size ? `寸法 ${JSON.stringify(element.size)}` : null,
    element.z_order !== null && element.z_order !== undefined ? `z=${element.z_order}` : null
  ]
  return details.filter(Boolean).join(' / ')
}

export function ShapePreview({
  element,
  childCount = 0
}: {
  element: RichPreviewElement
  childCount?: number
}): React.JSX.Element {
  if (element.type === 'connector') {
    return (
      <div
        data-testid="word-connector-preview"
        style={{ border: '1px dashed var(--d2d-border)', borderRadius: 4, padding: '6px 10px', margin: '6px 0' }}
      >
        <strong>
          {element.begin_arrow && element.begin_arrow !== 'none' ? '◀' : '○'} ─────────{' '}
          {element.end_arrow && element.end_arrow !== 'none' ? '▶' : '○'}
        </strong>
        <span style={{ marginLeft: 8, color: 'var(--d2d-fg-muted)' }}>
          接続 {element.start_native_id ?? '?'} → {element.end_native_id ?? '?'}
        </span>
        {shapeDetail(element) && <div style={{ fontSize: 11.5 }}>{shapeDetail(element)}</div>}
      </div>
    )
  }

  const paragraphs = element.text_body?.paragraphs ?? []
  return (
    <div
      data-testid={element.type === 'group_shape' ? 'word-group-shape-preview' : 'word-shape-preview'}
      style={{
        border: element.type === 'group_shape' ? '2px dashed var(--d2d-border)' : '2px solid var(--d2d-border)',
        borderRadius: element.shape_type === 'roundRect' ? 12 : 4,
        padding: 10,
        margin: '6px 0',
        minHeight: element.type === 'group_shape' ? 34 : 48,
        background: 'color-mix(in srgb, var(--d2d-bg) 88%, var(--d2d-accent))'
      }}
    >
      <div style={{ fontSize: 11.5, color: 'var(--d2d-fg-muted)' }}>
        {element.type === 'group_shape' ? `グループ図形（子要素 ${childCount}）` : shapeDetail(element) || '図形'}
      </div>
      {paragraphs.length > 0
        ? paragraphs.map((paragraph, index) => (
            <p key={index} style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>
              <RichText text={paragraph.text} runs={paragraph.runs} />
              <FieldBadges fields={paragraph.fields} />
            </p>
          ))
        : element.text && <p style={{ margin: '4px 0' }}>{element.text}</p>}
    </div>
  )
}

const STORY_LABELS: Record<string, string> = {
  header: 'ヘッダ',
  footer: 'フッタ',
  footnote: '脚注',
  endnote: '文末脚注'
}

export function StoryPreview({ story }: { story: PreviewStory }): React.JSX.Element {
  return (
    <section
      data-testid={`word-story-${story.story_type}`}
      style={{
        margin: '8px 0',
        padding: '7px 10px',
        borderBlock: '1px solid var(--d2d-border)',
        background: 'color-mix(in srgb, var(--d2d-bg) 94%, var(--d2d-accent))'
      }}
    >
      <div style={{ fontSize: 11.5, color: 'var(--d2d-fg-muted)' }}>
        {STORY_LABELS[story.story_type] ?? story.story_type}
        {story.source_part ? ` — ${story.source_part}` : ''}
      </div>
      {story.elements.map((element) => (
        <p key={element.id} style={{ margin: '3px 0', whiteSpace: 'pre-wrap' }}>
          <RichText text={element.text} runs={element.runs} />
          <FieldBadges fields={element.fields} />
        </p>
      ))}
    </section>
  )
}

export function ReviewAnnotations({
  comments,
  revisions
}: {
  comments?: PreviewComment[]
  revisions?: PreviewRevision[]
}): React.JSX.Element | null {
  if ((!comments || comments.length === 0) && (!revisions || revisions.length === 0)) return null
  return (
    <section data-testid="word-review-annotations" style={{ marginTop: 12, borderTop: '1px solid var(--d2d-border)' }}>
      <h3 style={{ fontSize: 13 }}>コメント・変更履歴</h3>
      {comments?.map((comment, index) => (
        <div key={`comment-${comment.comment_id ?? index}`} style={{ margin: '5px 0' }}>
          <span className="d2d-badge">コメント</span> {comment.text}
          <small style={{ marginLeft: 6, color: 'var(--d2d-fg-muted)' }}>{comment.author}</small>
        </div>
      ))}
      {revisions?.map((revision, index) => (
        <div key={`revision-${revision.revision_id ?? index}`} style={{ margin: '5px 0' }}>
          <span className="d2d-badge">{revision.type ?? '変更'}</span> {revision.text}
          <small style={{ marginLeft: 6, color: 'var(--d2d-fg-muted)' }}>{revision.author}</small>
        </div>
      ))}
    </section>
  )
}
