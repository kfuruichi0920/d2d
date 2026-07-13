/** JSON-compatible structures for format-independent document inspection (DATA-001 / EDIT-002). */
type JsonNodeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export function getJsonNodeKind(value: unknown): JsonNodeKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

function PrimitiveValue({ value }: { value: unknown }): React.JSX.Element {
  const kind = getJsonNodeKind(value)
  const label = kind === 'string' ? JSON.stringify(String(value)) : kind === 'null' ? 'null' : String(value)
  return <span className={`structured-json-value ${kind}`}>{label}</span>
}

function JsonNode({ value, depth = 0 }: { value: unknown; depth?: number }): React.JSX.Element {
  const kind = getJsonNodeKind(value)
  if (kind !== 'object' && kind !== 'array') return <PrimitiveValue value={value} />

  const entries =
    kind === 'array'
      ? (value as unknown[]).map((item, index) => [String(index), item] as const)
      : Object.entries(value as Record<string, unknown>)
  const [open, close] = kind === 'array' ? ['[', ']'] : ['{', '}']
  if (entries.length === 0) return <span className="structured-json-punctuation">{open + close}</span>

  return (
    <details className="structured-json-node" open={depth < 2}>
      <summary>
        <span className="structured-json-punctuation">{open}</span>
        <span className="structured-json-count">
          {entries.length} {kind === 'array' ? 'items' : 'keys'}
        </span>
      </summary>
      <div className="structured-json-children">
        {entries.map(([key, child]) => (
          <div className="structured-json-entry" key={key}>
            <span className={kind === 'array' ? 'structured-json-index' : 'structured-json-key'}>
              {kind === 'array' ? key : JSON.stringify(key)}
            </span>
            <span className="structured-json-colon">: </span>
            <JsonNode value={child} depth={depth + 1} />
          </div>
        ))}
      </div>
      <span className="structured-json-punctuation">{close}</span>
    </details>
  )
}

export function StructuredJsonView({ value, testId }: { value: unknown; testId: string }): React.JSX.Element {
  return (
    <div className="structured-json-view" data-testid={testId}>
      <JsonNode value={value} />
    </div>
  )
}
