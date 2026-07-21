/**
 * Help画面のSVG図解群（UI-051/057）。
 * D2Dの他画面（TraceGraphEditor等）と同じ「座標計算＋生SVG＋CSS変数配色」パターンを踏襲し、
 * 立体的な箱ではなくフラットな面＋枠線でレイヤーを表現して既存の意匠と統一感を保つ。
 */
import { useState } from 'react'

// ---- ①〜④ 操作の流れ（アニメーション付きフロー） ----

const FLOW_STAGES = [
  { no: '①', name: '原本', color: 'var(--d2d-fg-muted)' },
  { no: '②', name: '抽出データ', color: '#4aa3df' },
  { no: '③', name: '中間データ', color: '#50aaa0' },
  { no: '④', name: '設計モデル', color: '#7e9ddd' },
  { no: '分析', name: 'トレーサビリティ', color: 'var(--d2d-accent)' }
]

export function WorkflowFlowDiagram(): React.JSX.Element {
  const boxWidth = 132
  const boxHeight = 48
  const gap = 56
  const width = FLOW_STAGES.length * boxWidth + (FLOW_STAGES.length - 1) * gap + 16
  const height = boxHeight + 16
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="①原本から④設計モデル・トレーサビリティ分析までの流れ"
      data-testid="help-workflow-diagram"
      style={{ maxWidth: '100%' }}
    >
      <defs>
        <marker id="help-flow-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" fill="var(--d2d-accent)" />
        </marker>
      </defs>
      {FLOW_STAGES.slice(0, -1).map((_, index) => {
        const x1 = 8 + index * (boxWidth + gap) + boxWidth
        const x2 = x1 + gap
        const y = 8 + boxHeight / 2
        return (
          <line
            key={index}
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            stroke="var(--d2d-accent)"
            strokeWidth={2}
            strokeDasharray="6 5"
            markerEnd="url(#help-flow-arrow)"
            className="d2d-flow-dash"
          />
        )
      })}
      {FLOW_STAGES.map((stage, index) => {
        const x = 8 + index * (boxWidth + gap)
        return (
          <g key={stage.no} transform={`translate(${x},8)`}>
            <rect
              width={boxWidth}
              height={boxHeight}
              rx={7}
              fill="var(--d2d-surface)"
              stroke={stage.color}
              strokeWidth={2}
            />
            <text x={boxWidth / 2} y={20} textAnchor="middle" fontSize={13} fontWeight={800} fill={stage.color}>
              {stage.no}
            </text>
            <text x={boxWidth / 2} y={37} textAnchor="middle" fontSize={12} fill="var(--d2d-fg)">
              {stage.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ---- データスキーマ: entity_registryを中心としたハブ図 ----

const SCHEMA_LAYERS = [
  { label: '文書層', detail: 'source_document', color: '#4aa3df' },
  { label: '②③ Resource層', detail: 'resource_*', color: '#50aaa0' },
  { label: '④ 設計モデル層', detail: 'model_*', color: '#7e9ddd' },
  { label: '関係層', detail: 'trace_link', color: 'var(--d2d-accent)' }
]

export function SchemaHubDiagram(): React.JSX.Element {
  const hubWidth = 180
  const hubHeight = 46
  const childWidth = 150
  const childHeight = 46
  const gap = 26
  const width = SCHEMA_LAYERS.length * (childWidth + gap) - gap + 16
  const hubY = 8
  const childY = hubY + hubHeight + 46
  const height = childY + childHeight + 8
  const hubX = width / 2 - hubWidth / 2
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="entity_registryを中心とした共通台帳とデータ層の関係"
      data-testid="help-schema-diagram"
      style={{ maxWidth: '100%' }}
    >
      <defs>
        <marker id="help-schema-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--d2d-fg-muted)" />
        </marker>
      </defs>
      {SCHEMA_LAYERS.map((layer, index) => {
        const x = 8 + index * (childWidth + gap)
        const x1 = hubX + hubWidth / 2
        const y1 = hubY + hubHeight
        const x2 = x + childWidth / 2
        const y2 = childY
        const midY = (y1 + y2) / 2
        return (
          <path
            key={layer.label}
            d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
            fill="none"
            stroke={layer.color}
            strokeWidth={1.6}
            strokeDasharray="5 4"
            markerEnd="url(#help-schema-arrow)"
            className="d2d-flow-dash"
          />
        )
      })}
      <g transform={`translate(${hubX},${hubY})`}>
        <rect
          width={hubWidth}
          height={hubHeight}
          rx={7}
          fill="var(--d2d-surface)"
          stroke="var(--d2d-accent)"
          strokeWidth={2.5}
        />
        <text x={hubWidth / 2} y={19} textAnchor="middle" fontSize={12} fontWeight={800} fill="var(--d2d-accent)">
          共通台帳
        </text>
        <text x={hubWidth / 2} y={35} textAnchor="middle" fontSize={11.5} fill="var(--d2d-fg-muted)">
          entity_registry
        </text>
      </g>
      {SCHEMA_LAYERS.map((layer, index) => {
        const x = 8 + index * (childWidth + gap)
        return (
          <g key={layer.label} transform={`translate(${x},${childY})`}>
            <rect
              width={childWidth}
              height={childHeight}
              rx={7}
              fill="var(--d2d-surface)"
              stroke={layer.color}
              strokeWidth={1.6}
            />
            <text x={childWidth / 2} y={19} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={layer.color}>
              {layer.label}
            </text>
            <text x={childWidth / 2} y={35} textAnchor="middle" fontSize={11} fill="var(--d2d-fg-muted)">
              {layer.detail}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ---- 設計モデル: 3次元関係空間（レイヤー積層＋関係図） ----

export interface OntologyModelInfo {
  model_type: string
  label: string
  layer: string
  definition: string
  is_enabled: number
}
export interface OntologyRelationInfo {
  relation_type: string
  label: string
  definition: string
  icon_color: string
  icon_text: string
  is_enabled: number
}
export interface OntologyAllowanceInfo {
  relation_type: string
  source_model_type: string
  target_model_type: string
  allowed: number
}

/** 既知のレイヤー表示順（sdd_data_structure §9.1 の並び）。未知レイヤーは末尾へ追加する */
const LAYER_ORDER = ['根拠', '要求', '論理設計', '情報・契約', '評価', '実現', '知識・管理']
/** 全モデル間で使用可能なワイルドカード関係（図では凡例注記のみとし、矢印描画からは除外して過密を避ける） */
const WILDCARD_RELATIONS = new Set(['relates_to', 'conflicts_with'])
const GROUND_RELATION = 'based_on'

const CHIP_HEIGHT = 34
const CHIP_GAP = 10
const CHIP_MIN_WIDTH = 96
const BAND_PADDING = 14
const BAND_LABEL_HEIGHT = 22
const BAND_GAP = 46
const RIGHT_LANE_WIDTH = 28
const LEFT_MARGIN = 92

interface Lane {
  spans: [number, number][]
}

/** 区間スケジューリング: 重ならない区間を同じレーンへ詰める（既存レーンで衝突しなければ再利用） */
function assignLane(lanes: Lane[], from: number, to: number): number {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i]!.spans.every(([a, b]) => hi < a || lo > b)) {
      lanes[i]!.spans.push([lo, hi])
      return i
    }
  }
  lanes.push({ spans: [[lo, hi]] })
  return lanes.length - 1
}

export function OntologyLayerDiagram({
  models,
  relations,
  allowances
}: {
  models: OntologyModelInfo[]
  relations: OntologyRelationInfo[]
  allowances: OntologyAllowanceInfo[]
}): React.JSX.Element {
  const [hoverLayer, setHoverLayer] = useState<string | null>(null)
  const [hoverRelation, setHoverRelation] = useState<string | null>(null)

  const enabledModels = models.filter((m) => m.is_enabled === 1)
  const layerOf = new Map(enabledModels.map((m) => [m.model_type, m.layer]))
  const layersPresent = [...new Set(enabledModels.map((m) => m.layer))]
  const layerOrder = [
    ...LAYER_ORDER.filter((l) => layersPresent.includes(l)),
    ...layersPresent.filter((l) => !LAYER_ORDER.includes(l))
  ]

  const relationByType = new Map(relations.filter((r) => r.is_enabled === 1).map((r) => [r.relation_type, r]))

  // レイヤー毎のモデルchip位置（横並び、幅は文字数から概算）
  const layerModels = new Map<string, { model_type: string; label: string; x: number; width: number }[]>()
  let diagramWidth = LEFT_MARGIN
  for (const layer of layerOrder) {
    const items = enabledModels.filter((m) => m.layer === layer)
    let x = LEFT_MARGIN
    const positioned = items.map((m) => {
      const width = Math.max(CHIP_MIN_WIDTH, m.label.length * 13 + 24)
      const chip = { model_type: m.model_type, label: m.label, x, width }
      x += width + CHIP_GAP
      return chip
    })
    layerModels.set(layer, positioned)
    diagramWidth = Math.max(diagramWidth, x + CHIP_GAP)
  }

  const bandHeight = BAND_LABEL_HEIGHT + BAND_PADDING * 2 + CHIP_HEIGHT
  const bandY = new Map(layerOrder.map((layer, index) => [layer, index * (bandHeight + BAND_GAP)]))
  const diagramHeight = layerOrder.length * (bandHeight + BAND_GAP) - BAND_GAP + 20

  // 同一レイヤー内の関係（model単位で矢印を描く）。同じchip対に複数関係がある場合は弧の高さをずらす
  interface IntraArrow {
    layer: string
    fromX: number
    toX: number
    relationType: string
    stack: number
  }
  const intraArrows: IntraArrow[] = []
  const intraStack = new Map<string, number>()
  // レイヤー間の関係は「関係種別ごとに1本の共通バス」へ集約する（多対多を層ペア毎に引くと過密になるため）
  interface RelationTrunk {
    relationType: string
    sourceLayerIdx: Set<number>
    targetLayerIdx: Set<number>
  }
  const trunks = new Map<string, RelationTrunk>()

  for (const allowance of allowances) {
    if (allowance.allowed !== 1) continue
    if (WILDCARD_RELATIONS.has(allowance.relation_type)) continue
    if (!relationByType.has(allowance.relation_type)) continue // 無効化された関係種別は矢印から除外する
    const fromLayer = layerOf.get(allowance.source_model_type)
    const toLayer = layerOf.get(allowance.target_model_type)
    if (!fromLayer || !toLayer) continue
    if (fromLayer === toLayer) {
      const chips = layerModels.get(fromLayer) ?? []
      const from = chips.find((c) => c.model_type === allowance.source_model_type)
      const to = chips.find((c) => c.model_type === allowance.target_model_type)
      if (from && to && from.model_type !== to.model_type) {
        const pairKey = `${fromLayer}:${Math.min(from.x, to.x)}:${Math.max(from.x, to.x)}`
        const stack = intraStack.get(pairKey) ?? 0
        intraStack.set(pairKey, stack + 1)
        intraArrows.push({
          layer: fromLayer,
          fromX: from.x + from.width / 2,
          toX: to.x + to.width / 2,
          relationType: allowance.relation_type,
          stack
        })
      }
      continue
    }
    const fromIdx = layerOrder.indexOf(fromLayer)
    const toIdx = layerOrder.indexOf(toLayer)
    if (fromIdx < 0 || toIdx < 0) continue
    const trunk = trunks.get(allowance.relation_type) ?? {
      relationType: allowance.relation_type,
      sourceLayerIdx: new Set<number>(),
      targetLayerIdx: new Set<number>()
    }
    trunk.sourceLayerIdx.add(fromIdx)
    trunk.targetLayerIdx.add(toIdx)
    trunks.set(allowance.relation_type, trunk)
  }

  // トランク（関係種別毎の共通バス）のレーン割当。関与する最上位〜最下位レイヤーの範囲で衝突回避する
  const lanes: Lane[] = []
  const trunkList = [...trunks.values()].map((trunk) => {
    const allIdx = [...trunk.sourceLayerIdx, ...trunk.targetLayerIdx]
    const minIdx = Math.min(...allIdx)
    const maxIdx = Math.max(...allIdx)
    return { ...trunk, minIdx, maxIdx, lane: assignLane(lanes, minIdx, maxIdx) }
  })
  const rightMargin = 56 + Math.max(1, lanes.length) * RIGHT_LANE_WIDTH
  const totalWidth = diagramWidth + rightMargin

  const basedOnColor = relationByType.get(GROUND_RELATION)?.icon_color ?? 'var(--d2d-fg-muted)'
  const dimmed = (active: boolean): number => (hoverLayer || hoverRelation ? (active ? 1 : 0.18) : 0.9)

  return (
    <div>
      <div style={{ overflow: 'auto', border: '1px solid var(--d2d-border)', borderRadius: 8 }}>
        <svg
          width={totalWidth}
          height={diagramHeight}
          viewBox={`0 0 ${totalWidth} ${diagramHeight}`}
          role="img"
          aria-label="SW設計オントロジーのレイヤーと関係の概念図"
          data-testid="help-ontology-diagram"
          style={{ display: 'block' }}
        >
          {/* 根拠バス（based_on）: 各レイヤーから左側の①②③根拠へ向かう共通線 */}
          <line
            x1={28}
            y1={10}
            x2={28}
            y2={diagramHeight - 30}
            stroke={basedOnColor}
            strokeWidth={2}
            strokeDasharray="4 4"
            opacity={dimmed(hoverRelation === GROUND_RELATION)}
          />
          <g transform={`translate(4,${diagramHeight - 26})`} opacity={dimmed(hoverRelation === GROUND_RELATION)}>
            <rect width={72} height={22} rx={5} fill="var(--d2d-surface)" stroke={basedOnColor} strokeWidth={1.4} />
            <text x={36} y={15} textAnchor="middle" fontSize={9.5} fill={basedOnColor}>
              ①②③根拠
            </text>
          </g>
          {layerOrder.map((layer) => {
            const y = bandY.get(layer)! + BAND_PADDING + BAND_LABEL_HEIGHT + CHIP_HEIGHT / 2
            return (
              <line
                key={`ground-${layer}`}
                x1={28}
                y1={y}
                x2={LEFT_MARGIN - 14}
                y2={y}
                stroke={basedOnColor}
                strokeWidth={1.4}
                strokeDasharray="3 3"
                markerEnd="url(#help-onto-ground-arrow)"
                opacity={dimmed(hoverLayer === layer || hoverRelation === GROUND_RELATION)}
              />
            )
          })}

          <defs>
            <marker id="help-onto-ground-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill={basedOnColor} />
            </marker>
            {[...relationByType.values()].map((relation) => (
              <marker
                key={relation.relation_type}
                id={`help-onto-arrow-${relation.relation_type}`}
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3.5"
                orient="auto"
              >
                <path d="M0,0 L7,3.5 L0,7 Z" fill={relation.icon_color} />
              </marker>
            ))}
          </defs>

          {/* レイヤー帯 */}
          {layerOrder.map((layer) => {
            const y = bandY.get(layer)!
            const chips = layerModels.get(layer) ?? []
            const active = hoverLayer === layer
            return (
              <g
                key={layer}
                opacity={dimmed(active) === 0.9 && !hoverLayer ? 1 : dimmed(active)}
                onMouseEnter={() => setHoverLayer(layer)}
                onMouseLeave={() => setHoverLayer(null)}
                style={{ cursor: 'default' }}
              >
                <rect
                  x={LEFT_MARGIN - 20}
                  y={y}
                  width={diagramWidth - LEFT_MARGIN + 20}
                  height={bandHeight}
                  rx={8}
                  fill="var(--d2d-surface)"
                  stroke={active ? 'var(--d2d-accent)' : 'var(--d2d-border)'}
                  strokeWidth={active ? 2 : 1}
                />
                <text x={LEFT_MARGIN - 8} y={y + 16} fontSize={12} fontWeight={800} fill="var(--d2d-fg)">
                  {layer}
                </text>
                {chips.map((chip) => (
                  <g key={chip.model_type} transform={`translate(${chip.x},${y + BAND_PADDING + BAND_LABEL_HEIGHT})`}>
                    <rect
                      width={chip.width}
                      height={CHIP_HEIGHT}
                      rx={6}
                      fill="var(--d2d-bg)"
                      stroke="var(--d2d-border)"
                      strokeWidth={1}
                    />
                    <text
                      x={chip.width / 2}
                      y={14}
                      textAnchor="middle"
                      fontSize={10.5}
                      fontWeight={700}
                      fill="var(--d2d-fg)"
                    >
                      {chip.label}
                    </text>
                    <text x={chip.width / 2} y={27} textAnchor="middle" fontSize={9} fill="var(--d2d-fg-muted)">
                      {chip.model_type}
                    </text>
                  </g>
                ))}
              </g>
            )
          })}

          {/* レイヤー内の関係（モデル同士）。同じchip対に複数関係があれば弧の高さをずらして重ならないようにする */}
          {intraArrows.map((arrow, index) => {
            const baseY = bandY.get(arrow.layer)! + BAND_PADDING + BAND_LABEL_HEIGHT + CHIP_HEIGHT
            const arcHeight = 14 + arrow.stack * 22
            const y = baseY
            const relation = relationByType.get(arrow.relationType)
            const color = relation?.icon_color ?? 'var(--d2d-fg-muted)'
            const active = hoverRelation === arrow.relationType || hoverLayer === arrow.layer
            const midX = (arrow.fromX + arrow.toX) / 2
            return (
              <g key={index} opacity={dimmed(active)}>
                <path
                  d={`M ${arrow.fromX} ${y} C ${arrow.fromX} ${y + arcHeight}, ${arrow.toX} ${y + arcHeight}, ${arrow.toX} ${y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.4}
                  markerEnd={`url(#help-onto-arrow-${arrow.relationType})`}
                />
                <text x={midX} y={y + arcHeight + 10} textAnchor="middle" fontSize={9} fill={color}>
                  {relation?.label ?? arrow.relationType}
                </text>
              </g>
            )
          })}

          {/* レイヤー間の関係: 種別毎に1本の共通バス。source層は素線で合流、target層は矢印で分岐する */}
          {trunkList.map((trunk) => {
            const relation = relationByType.get(trunk.relationType)
            const color = relation?.icon_color ?? 'var(--d2d-fg-muted)'
            const laneX = diagramWidth + trunk.lane * RIGHT_LANE_WIDTH + RIGHT_LANE_WIDTH / 2
            const bandRight = diagramWidth
            const yOf = (layerIdx: number): number =>
              bandY.get(layerOrder[layerIdx]!)! + BAND_PADDING + BAND_LABEL_HEIGHT + CHIP_HEIGHT / 2
            const trunkTop = yOf(trunk.minIdx)
            const trunkBottom = yOf(trunk.maxIdx)
            const active = hoverRelation === trunk.relationType
            return (
              <g key={trunk.relationType} opacity={dimmed(active)}>
                <line x1={laneX} y1={trunkTop} x2={laneX} y2={trunkBottom} stroke={color} strokeWidth={1.6} />
                {[...trunk.sourceLayerIdx].map((layerIdx) => (
                  <line
                    key={`src-${layerIdx}`}
                    x1={bandRight}
                    y1={yOf(layerIdx)}
                    x2={laneX}
                    y2={yOf(layerIdx)}
                    stroke={color}
                    strokeWidth={1.6}
                  />
                ))}
                {[...trunk.targetLayerIdx].map((layerIdx) => (
                  <line
                    key={`tgt-${layerIdx}`}
                    x1={laneX}
                    y1={yOf(layerIdx)}
                    x2={bandRight}
                    y2={yOf(layerIdx)}
                    stroke={color}
                    strokeWidth={1.6}
                    markerEnd={`url(#help-onto-arrow-${trunk.relationType})`}
                  />
                ))}
                <text x={laneX + 5} y={(trunkTop + trunkBottom) / 2} fontSize={9.5} fontWeight={700} fill={color}>
                  {relation?.label ?? trunk.relationType}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="d2d-ontology-legend" data-testid="help-ontology-legend">
        {[...relationByType.values()].map((relation) => (
          <button
            key={relation.relation_type}
            type="button"
            className={`d2d-legend-chip ${hoverRelation === relation.relation_type ? 'active' : ''}`}
            style={{ borderColor: relation.icon_color, color: relation.icon_color }}
            onMouseEnter={() => setHoverRelation(relation.relation_type)}
            onMouseLeave={() => setHoverRelation(null)}
            title={relation.definition}
          >
            <span style={{ background: relation.icon_color }} />
            {relation.label}
          </button>
        ))}
      </div>
      <p className="d2d-help-note" style={{ marginTop: 10 }}>
        <b>読み方</b>
        レイヤーをまたぐ関係は種別ごとに1本の共通バス（右側の縦線）へ集約しています。
        細い線でバスへ合流するレイヤーが起点、矢印付きでバスから分岐するレイヤーが終点です。 左端の縦線は根拠（
        <code>based_on</code>）が①〜③の原本・抽出・中間データへ向かうことを表します。
        <code>relates_to</code>（暫定関連）・<code>conflicts_with</code>（競合）は全モデル間で使用できる汎用関係のため、
        矢印が過密にならないよう図には描かず、下の関係一覧だけに表示しています。
        レイヤー帯・凡例チップにマウスを乗せると関係する矢印だけを強調表示します。
      </p>
    </div>
  )
}
