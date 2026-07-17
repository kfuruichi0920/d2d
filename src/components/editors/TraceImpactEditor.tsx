/**
 * 汎用インパクト分析Editor（P9-5、TRACE-030〜034、UI-015）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'

interface ImpactScope {
  id: string
  kind: 'design' | 'extracted' | 'intermediate' | 'resource_type'
  label: string
  description: string
  count: number
}

interface ImpactItem {
  uid: string
  code: string
  title: string | null
  entityType: string
  designCategory: string | null
  status: string
  itemType: string | null
  scopes: string[]
  parentUid: string | null
  depth: number
  hasChildren: boolean
}

interface ImpactColumn {
  id: string
  scopeIds: string[]
  items: ImpactItem[]
  truncated: boolean
}

interface ImpactLink {
  uid: string
  leftColumnId: string
  rightColumnId: string
  leftUid: string
  rightUid: string
  fromUid: string
  toUid: string
  relationType: string
  displayDirection: 'left_to_right' | 'right_to_left' | 'bidirectional'
  reviewStatus: string | null
  rationale: string | null
  confidence: number | null
}

interface ImpactView {
  columns: ImpactColumn[]
  links: ImpactLink[]
  relationTypes: string[]
  truncatedLinks: boolean
}

interface ColumnConfig {
  id: string
  scopeIds: string[]
}

interface DisplayLink extends ImpactLink {
  key: string
  count: number
  sourceLinks: ImpactLink[]
}

interface PositionedLink extends DisplayLink {
  path: string
  labelX: number
  labelY: number
}

const MAX_COLUMNS = 8
const RELATION_COLORS: Record<string, string> = {
  based_on: '#4aa3df',
  satisfies: '#50b36b',
  allocated_to: '#b08adf',
  verifies: '#df789e',
  contains: '#d99b42',
  decomposes: '#c77c55',
  implements: '#7e9ddd',
  uses: '#50aaa0',
  calls: '#8d8dd8',
  conflicts_with: '#df5c5c',
  relates_to: '#9099a8'
}
const RELATION_LABELS: Record<string, string> = {
  based_on: 'B',
  satisfies: 'S',
  allocated_to: 'A',
  verifies: 'V',
  contains: 'C',
  decomposes: 'D',
  implements: 'I',
  uses: 'U',
  calls: 'Call',
  conflicts_with: '!',
  relates_to: 'R'
}

function nodeKey(columnId: string, uid: string): string {
  return `${columnId}:${uid}`
}

function selectedOptions(event: React.ChangeEvent<HTMLSelectElement>): string[] {
  return [...event.currentTarget.selectedOptions].map((option) => option.value)
}

function itemTooltip(item: ImpactItem, scopes: ImpactScope[]): string {
  const scopeLabels = item.scopes.map((id) => scopes.find((scope) => scope.id === id)?.label ?? id)
  return [
    `ID: ${item.code}`,
    `名称: ${item.title ?? '-'}`,
    `entity_type: ${item.entityType}`,
    `design_category: ${item.designCategory ?? '-'}`,
    `item_type: ${item.itemType ?? '-'}`,
    `状態: ${item.status}`,
    `階層: ${item.depth}`,
    `所属: ${scopeLabels.join(' / ')}`
  ].join('\n')
}

function linkTooltip(link: DisplayLink): string {
  const source = link.sourceLinks[0]!
  return [
    `関係: ${link.relationType}`,
    `方向: ${link.displayDirection}`,
    `from: ${source.fromUid}`,
    `to: ${source.toUid}`,
    `review_status: ${source.reviewStatus ?? '-'}`,
    `confidence: ${source.confidence ?? '-'}`,
    `rationale: ${source.rationale ?? '-'}`,
    link.count > 1 ? `折畳集約: ${link.count}リンク` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function TraceImpactEditor(): React.JSX.Element {
  const [scopes, setScopes] = useState<ImpactScope[]>([])
  const [configs, setConfigs] = useState<ColumnConfig[]>([])
  const [relationTypes, setRelationTypes] = useState<string[]>(['based_on'])
  const [allRelationTypes, setAllRelationTypes] = useState<string[]>([])
  const [view, setView] = useState<ImpactView | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)
  const [anchors, setAnchors] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [impactOnly, setImpactOnly] = useState(false)
  const [positionedLinks, setPositionedLinks] = useState<PositionedLink[]>([])
  const [measureVersion, setMeasureVersion] = useState(0)
  const notify = useJobsStore((state) => state.notify)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>())
  const frameRef = useRef<number | null>(null)
  const columnSequence = useRef(4)

  useEffect(() => {
    void invoke<ImpactScope[]>('trace.matrixScopes').then((result) => {
      if (!result.ok) {
        notify('error', '表示対象を取得できません', result.error.message)
        return
      }
      setScopes(result.result)
      setConfigs((current) => {
        if (current.length > 0) return current
        const preferred = [
          result.result.find((scope) => scope.kind === 'extracted'),
          result.result.find((scope) => scope.kind === 'intermediate'),
          result.result.find((scope) => scope.kind === 'design')
        ].filter((scope): scope is ImpactScope => Boolean(scope))
        const fallback = result.result.filter((scope) => !preferred.some((item) => item.id === scope.id))
        const initial = [...preferred, ...fallback].slice(0, Math.min(3, result.result.length))
        return initial.map((scope, index) => ({ id: `impact-column-${index + 1}`, scopeIds: [scope.id] }))
      })
    })
  }, [notify])

  const load = useCallback(async (): Promise<void> => {
    if (configs.length < 2 || configs.some((config) => config.scopeIds.length === 0)) {
      setView(null)
      return
    }
    const result = await invoke<ImpactView>('trace.impactView', { columns: configs, relationTypes })
    if (result.ok) {
      setView(result.result)
      setAllRelationTypes(result.result.relationTypes)
    } else {
      notify('error', 'インパクト分析を取得できません', result.error.message)
    }
  }, [configs, notify, relationTypes])

  useEffect(() => {
    void load()
    return onBackendEvent((event) => {
      if (['relation.updated', 'intermediate.updated', 'extraction.updated', 'design_model.updated'].includes(event)) {
        void load()
      }
    })
  }, [load])

  const graph = useMemo(() => {
    const adjacency = new Map<string, Set<string>>()
    const edgeByNodes = new Map<string, ImpactLink[]>()
    for (const link of view?.links ?? []) {
      const left = nodeKey(link.leftColumnId, link.leftUid)
      const right = nodeKey(link.rightColumnId, link.rightUid)
      ;(adjacency.get(left) ?? adjacency.set(left, new Set()).get(left)!).add(right)
      ;(adjacency.get(right) ?? adjacency.set(right, new Set()).get(right)!).add(left)
      const pair = [left, right].sort().join('|')
      ;(edgeByNodes.get(pair) ?? edgeByNodes.set(pair, []).get(pair)!).push(link)
    }
    return { adjacency, edgeByNodes }
  }, [view])

  const reachable = useMemo(() => {
    const result = new Set<string>()
    const queue = [...selected]
    queue.forEach((key) => result.add(key))
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const next of graph.adjacency.get(current) ?? []) {
        if (result.has(next)) continue
        result.add(next)
        queue.push(next)
      }
    }
    return result
  }, [graph, selected])

  const visibleByColumn = useMemo(() => {
    const result = new Map<string, ImpactItem[]>()
    for (const column of view?.columns ?? []) {
      const byUid = new Map(column.items.map((item) => [item.uid, item]))
      const include = new Set<string>()
      if (impactOnly && selected.size > 0 && column.id !== activeColumnId) {
        for (const item of column.items) {
          if (!reachable.has(nodeKey(column.id, item.uid))) continue
          let current: ImpactItem | undefined = item
          while (current) {
            include.add(current.uid)
            current = current.parentUid ? byUid.get(current.parentUid) : undefined
          }
        }
      } else {
        column.items.forEach((item) => include.add(item.uid))
      }
      const hiddenByCollapse = (item: ImpactItem): boolean => {
        let parentUid = item.parentUid
        while (parentUid) {
          if (collapsed.has(nodeKey(column.id, parentUid))) return true
          parentUid = byUid.get(parentUid)?.parentUid ?? null
        }
        return false
      }
      result.set(
        column.id,
        column.items.filter((item) => include.has(item.uid) && !hiddenByCollapse(item))
      )
    }
    return result
  }, [activeColumnId, collapsed, impactOnly, reachable, selected.size, view])

  const representative = useCallback(
    (columnId: string, uid: string): string | null => {
      const column = view?.columns.find((item) => item.id === columnId)
      if (!column) return null
      const visible = new Set((visibleByColumn.get(columnId) ?? []).map((item) => item.uid))
      const byUid = new Map(column.items.map((item) => [item.uid, item]))
      let current: ImpactItem | undefined = byUid.get(uid)
      while (current && !visible.has(current.uid))
        current = current.parentUid ? byUid.get(current.parentUid) : undefined
      return current ? nodeKey(columnId, current.uid) : null
    },
    [view, visibleByColumn]
  )

  const displayLinks = useMemo(() => {
    const grouped = new Map<string, DisplayLink>()
    for (const link of view?.links ?? []) {
      const left = representative(link.leftColumnId, link.leftUid)
      const right = representative(link.rightColumnId, link.rightUid)
      if (!left || !right) continue
      const key = `${left}|${right}|${link.relationType}|${link.displayDirection}`
      const current = grouped.get(key)
      if (current) {
        current.count += 1
        current.sourceLinks.push(link)
      } else {
        grouped.set(key, { ...link, key, count: 1, sourceLinks: [link] })
      }
    }
    return [...grouped.values()]
  }, [representative, view])

  const highlightedRepresentatives = useMemo(() => {
    const keys = new Set<string>()
    for (const key of reachable) {
      const separator = key.indexOf(':')
      const rep = representative(key.slice(0, separator), key.slice(separator + 1))
      if (rep) keys.add(rep)
    }
    return keys
  }, [reachable, representative])

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      setMeasureVersion((value) => value + 1)
    })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.addEventListener('scroll', scheduleMeasure, { passive: true })
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(viewport)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => {
      viewport.removeEventListener('scroll', scheduleMeasure)
      observer.disconnect()
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [scheduleMeasure])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const canvas = canvasRef.current
    if (!viewport || !canvas) return
    const canvasRect = canvas.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const overscan = 160
    const minY = viewportRect.top - overscan
    const maxY = viewportRect.bottom + overscan
    const clampY = (value: number): number => Math.max(viewportRect.top, Math.min(viewportRect.bottom, value))
    const positioned: PositionedLink[] = []
    displayLinks.forEach((link, index) => {
      const leftKey = representative(link.leftColumnId, link.leftUid)
      const rightKey = representative(link.rightColumnId, link.rightUid)
      const leftElement = leftKey ? nodeRefs.current.get(leftKey) : undefined
      const rightElement = rightKey ? nodeRefs.current.get(rightKey) : undefined
      if (!leftElement || !rightElement) return
      const leftRect = leftElement.getBoundingClientRect()
      const rightRect = rightElement.getBoundingClientRect()
      const leftY = leftRect.top + leftRect.height / 2
      const rightY = rightRect.top + rightRect.height / 2
      if ((leftY < minY || leftY > maxY) && (rightY < minY || rightY > maxY)) return
      const x1 = leftRect.right - canvasRect.left
      const x2 = rightRect.left - canvasRect.left
      const offset = ((index % 5) - 2) * 2
      const y1 = clampY(leftY) - canvasRect.top + offset
      const y2 = clampY(rightY) - canvasRect.top + offset
      const curve = Math.max(28, (x2 - x1) * 0.42)
      positioned.push({
        ...link,
        path: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
        labelX: (x1 + x2) / 2,
        labelY: (y1 + y2) / 2
      })
    })
    setPositionedLinks(positioned)
  }, [displayLinks, measureVersion, representative, visibleByColumn])

  useEffect(() => scheduleMeasure(), [configs, scheduleMeasure, view, visibleByColumn])

  const updateScopes = (id: string, scopeIds: string[]): void => {
    setConfigs((current) => current.map((config) => (config.id === id ? { ...config, scopeIds } : config)))
    setSelected(new Set())
    setCollapsed(new Set())
  }

  const addColumn = (index: number): void => {
    if (configs.length >= MAX_COLUMNS || scopes.length === 0) return
    const used = new Set(configs.flatMap((config) => config.scopeIds))
    const scope = scopes.find((item) => !used.has(item.id)) ?? scopes[0]!
    const config = { id: `impact-column-${columnSequence.current++}`, scopeIds: [scope.id] }
    setConfigs((current) => [...current.slice(0, index), config, ...current.slice(index)])
  }

  const removeColumn = (id: string): void => {
    if (configs.length <= 2) return
    setConfigs((current) => current.filter((config) => config.id !== id))
    setSelected((current) => new Set([...current].filter((key) => !key.startsWith(`${id}:`))))
    if (activeColumnId === id) setActiveColumnId(null)
  }

  const selectItem = (columnId: string, uid: string, event: React.MouseEvent): void => {
    const key = nodeKey(columnId, uid)
    const items = visibleByColumn.get(columnId) ?? []
    setActiveColumnId(columnId)
    setSelected((current) => {
      if (event.shiftKey && anchors[columnId]) {
        const start = items.findIndex((item) => item.uid === anchors[columnId])
        const end = items.findIndex((item) => item.uid === uid)
        if (start >= 0 && end >= 0) {
          const range = items.slice(Math.min(start, end), Math.max(start, end) + 1)
          const next = event.ctrlKey || event.metaKey ? new Set(current) : new Set<string>()
          range.forEach((item) => next.add(nodeKey(columnId, item.uid)))
          return next
        }
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }
      return new Set([key])
    })
    setAnchors((current) => ({ ...current, [columnId]: uid }))
  }

  const selectLinkEndpoints = (link: DisplayLink, event: React.MouseEvent): void => {
    const left = representative(link.leftColumnId, link.leftUid)
    const right = representative(link.rightColumnId, link.rightUid)
    if (!left || !right) return
    setSelected((current) => {
      const next = event.ctrlKey || event.metaKey ? new Set(current) : new Set<string>()
      next.add(left)
      next.add(right)
      return next
    })
    setActiveColumnId(link.leftColumnId)
  }

  const toggleCollapsed = (columnId: string, uid: string): void => {
    const key = nodeKey(columnId, uid)
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="trace-impact-editor" data-testid="trace-impact">
      <header className="trace-impact-toolbar">
        <div>
          <h1>汎用インパクト分析</h1>
          <span>任意のResource集合を列へ配置し、選択項目から左右へ連鎖する影響範囲を確認します</span>
        </div>
        <label className="trace-impact-mode">
          <input
            type="checkbox"
            checked={impactOnly}
            disabled={selected.size === 0}
            onChange={(event) => setImpactOnly(event.target.checked)}
            data-testid="impact-related-only"
          />
          関連項目のみ表示
        </label>
        <button
          type="button"
          className="d2d-btn"
          onClick={() => {
            setSelected(new Set())
            setImpactOnly(false)
          }}
          disabled={selected.size === 0}
          title="項目選択とインパクト強調を解除します"
          data-testid="impact-clear-selection"
        >
          選択解除
        </button>
        <span>{selected.size}項目選択</span>
      </header>

      <fieldset className="trace-impact-relations">
        <legend>表示する関係種別（複数選択可）</legend>
        {allRelationTypes.map((type) => (
          <label key={type} style={{ '--relation-color': RELATION_COLORS[type] } as React.CSSProperties}>
            <input
              type="checkbox"
              checked={relationTypes.includes(type)}
              onChange={(event) =>
                setRelationTypes((current) =>
                  event.target.checked ? [...current, type] : current.filter((value) => value !== type)
                )
              }
              data-testid={`impact-relation-${type}`}
            />
            <span>{RELATION_LABELS[type]}</span>
            {type}
          </label>
        ))}
      </fieldset>

      {(view?.truncatedLinks || view?.columns.some((column) => column.truncated)) && (
        <div className="trace-impact-limit" role="status">
          表示上限に達しました。列のResource集合または関係種別を絞り込んでください。
        </div>
      )}

      <div className="trace-impact-viewport" ref={viewportRef} data-testid="impact-viewport">
        <div className="trace-impact-canvas" ref={canvasRef} style={{ minWidth: `${configs.length * 310 + 60}px` }}>
          <svg className="trace-impact-links" aria-label="方向付きトレースリンク">
            <defs>
              {allRelationTypes.map((type) => (
                <marker
                  key={type}
                  id={`impact-arrow-${type}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill={RELATION_COLORS[type]} />
                </marker>
              ))}
            </defs>
            {positionedLinks.map((link) => {
              const left = representative(link.leftColumnId, link.leftUid)
              const right = representative(link.rightColumnId, link.rightUid)
              const highlighted =
                selected.size === 0 ||
                (Boolean(left && highlightedRepresentatives.has(left)) &&
                  Boolean(right && highlightedRepresentatives.has(right)))
              const color = RELATION_COLORS[link.relationType] ?? '#9099a8'
              return (
                <g key={link.key} className={highlighted ? 'impact-link highlighted' : 'impact-link dimmed'}>
                  <path
                    d={link.path}
                    stroke={color}
                    markerStart={
                      link.displayDirection !== 'left_to_right' ? `url(#impact-arrow-${link.relationType})` : undefined
                    }
                    markerEnd={
                      link.displayDirection !== 'right_to_left' ? `url(#impact-arrow-${link.relationType})` : undefined
                    }
                    onClick={(event) => selectLinkEndpoints(link, event)}
                    data-testid={`impact-link-${link.uid}`}
                  >
                    <title>{linkTooltip(link)}</title>
                  </path>
                  <text x={link.labelX} y={link.labelY - 3} fill={color}>
                    {RELATION_LABELS[link.relationType] ?? link.relationType}
                    {link.count > 1 ? `×${link.count}` : ''}
                  </text>
                </g>
              )
            })}
          </svg>

          <div className="trace-impact-columns">
            {configs.map((config, index) => {
              const column = view?.columns.find((item) => item.id === config.id)
              const items = visibleByColumn.get(config.id) ?? []
              return (
                <section className="trace-impact-column" key={config.id} data-testid={`impact-column-${index}`}>
                  <div className="trace-impact-column-header">
                    <strong>リスト {index + 1}</strong>
                    <div>
                      <button
                        type="button"
                        className="d2d-btn small"
                        onClick={() => addColumn(index)}
                        disabled={configs.length >= MAX_COLUMNS}
                        title="このリストの左側へ新しいリストを追加します"
                      >
                        ＋左
                      </button>
                      <button
                        type="button"
                        className="d2d-btn small"
                        onClick={() => addColumn(index + 1)}
                        disabled={configs.length >= MAX_COLUMNS}
                        title="このリストの右側へ新しいリストを追加します"
                        data-testid={index === configs.length - 1 ? 'impact-add-right' : undefined}
                      >
                        右＋
                      </button>
                      <button
                        type="button"
                        className="d2d-btn small"
                        onClick={() => removeColumn(config.id)}
                        disabled={configs.length <= 2}
                        title="このリストを表示から削除します。Resourceや関係は削除しません"
                      >
                        削除
                      </button>
                    </div>
                    <select
                      multiple
                      size={Math.min(5, Math.max(3, scopes.length))}
                      value={config.scopeIds}
                      onChange={(event) => updateScopes(config.id, selectedOptions(event))}
                      title="このリストへ表示するResource集合を複数選択できます"
                      data-testid={`impact-scopes-${index}`}
                    >
                      {scopes.map((scope) => (
                        <option key={scope.id} value={scope.id} title={scope.description}>
                          {scope.label}（{scope.count}）
                        </option>
                      ))}
                    </select>
                    <small>{column ? `${items.length}/${column.items.length}項目` : '表示対象を選択'}</small>
                  </div>
                  <div className="trace-impact-list" role="listbox" aria-multiselectable="true">
                    {items.map((item) => {
                      const key = nodeKey(config.id, item.uid)
                      const isSelected = selected.has(key)
                      const isHighlighted = selected.size > 0 && highlightedRepresentatives.has(key)
                      const isCollapsed = collapsed.has(key)
                      return (
                        <button
                          key={item.uid}
                          type="button"
                          className={[
                            'trace-impact-item',
                            isSelected ? 'selected' : '',
                            isHighlighted ? 'impacted' : '',
                            selected.size > 0 && !isHighlighted ? 'dimmed' : ''
                          ].join(' ')}
                          style={{ paddingInlineStart: `${8 + item.depth * 14}px` }}
                          title={itemTooltip(item, scopes)}
                          onClick={(event) => selectItem(config.id, item.uid, event)}
                          ref={(element) => {
                            if (element) nodeRefs.current.set(key, element)
                            else nodeRefs.current.delete(key)
                          }}
                          aria-selected={isSelected}
                          data-testid={`impact-item-${index}-${item.code}`}
                        >
                          {item.hasChildren ? (
                            <span
                              className="trace-impact-disclosure"
                              role="button"
                              tabIndex={0}
                              aria-label={isCollapsed ? '子階層を展開' : '子階層を折り畳む'}
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleCollapsed(config.id, item.uid)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  toggleCollapsed(config.id, item.uid)
                                }
                              }}
                              data-testid={`impact-toggle-${index}-${item.code}`}
                            >
                              {isCollapsed ? '▸' : '▾'}
                            </span>
                          ) : (
                            <span className="trace-impact-indent" />
                          )}
                          <span className="trace-impact-code">{item.code}</span>
                          <span className="trace-impact-title">{item.title ?? item.itemType ?? item.entityType}</span>
                        </button>
                      )
                    })}
                    {items.length === 0 && <div className="d2d-empty">表示対象または関連項目がありません</div>}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
