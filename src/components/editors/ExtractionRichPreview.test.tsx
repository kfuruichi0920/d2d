/**
 * 抽出リッチプレビューのユニットテスト（P5-18、EXT-048）。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  RichText,
  ShapePreview,
  StoryPreview,
  styleFromRunFormat,
  type RichPreviewElement
} from './ExtractionRichPreview'

describe('ExtractionRichPreview', () => {
  it('Wordの直接文字書式をCSSへ変換する', () => {
    expect(
      styleFromRunFormat({
        bold: true,
        underline: 'double',
        strike: true,
        color: 'FF0000',
        highlight: 'yellow',
        font_size_half_points: '24',
        vertical_align: 'superscript'
      })
    ).toMatchObject({
      fontWeight: 700,
      textDecorationLine: 'underline line-through',
      textDecorationStyle: 'double',
      color: '#FF0000',
      backgroundColor: '#fff59d',
      fontSize: '12pt',
      verticalAlign: 'super'
    })
  })

  it('Run単位の装飾を文書プレビューへ反映する', () => {
    const html = renderToStaticMarkup(
      <RichText
        runs={[
          { text: '通常' },
          { text: '強調', format: { direct: { bold: true, strike: true, highlight: 'yellow' } } }
        ]}
      />
    )
    expect(html).toContain('通常')
    expect(html).toContain('強調')
    expect(html).toContain('font-weight:700')
    expect(html).toContain('line-through')
    expect(html).toContain('background-color:#fff59d')
  })

  it('図形とコネクタの保存情報を可視化する', () => {
    const shape: RichPreviewElement = {
      id: 'shape-1',
      type: 'shape',
      name: 'Process',
      shape_type: 'flowChartProcess',
      text_body: { paragraphs: [{ id: 'p1', type: 'paragraph', text: '入力処理' }] }
    }
    const connector: RichPreviewElement = {
      id: 'connector-1',
      type: 'connector',
      start_native_id: '11',
      end_native_id: '13',
      end_arrow: 'triangle'
    }
    expect(renderToStaticMarkup(<ShapePreview element={shape} />)).toContain('入力処理')
    const connectorHtml = renderToStaticMarkup(<ShapePreview element={connector} />)
    expect(connectorHtml).toContain('11')
    expect(connectorHtml).toContain('13')
    expect(connectorHtml).toContain('▶')
  })

  it('ヘッダ・フッタとWordフィールドを本文から区別して表示する', () => {
    const html = renderToStaticMarkup(
      <StoryPreview
        story={{
          story_type: 'footer',
          source_part: '/word/footer1.xml',
          elements: [
            {
              id: 'footer-1',
              type: 'paragraph',
              text: '2',
              fields: [{ instruction: ' PAGE ', cached_result: '2' }]
            }
          ]
        }}
      />
    )
    expect(html).toContain('フッタ')
    expect(html).toContain('/word/footer1.xml')
    expect(html).toContain('PAGE')
    expect(html).toContain('2')
  })
})
