/** セマンティック入力支援の共通型（P10-7、EDIT-057〜071）。 */
export type SemanticDisplayMode = 'link' | 'string' | 'id' | 'uid'
export type SemanticRelationType =
  | 'based_on'
  | 'satisfies'
  | 'allocated_to'
  | 'verifies'
  | 'contains'
  | 'implements'
  | 'uses'
  | 'calls'
  | 'conflicts_with'
  | 'relates_to'
export interface SemanticPolicy {
  candidateKinds: Array<'glossary' | 'model' | 'recent'>
  relationTypes: SemanticRelationType[]
  dictionaryScopes: string[]
  minimumPrefixLength: number
  maximumCandidates: number
  automaticMechanicalNormalization: boolean
  defaultDisplayMode: SemanticDisplayMode
  defaultRelationType: SemanticRelationType
  requireApprovalForStrongRelations: boolean
}
export interface SemanticReference {
  uid?: string
  startOffset: number
  endOffset: number
  surfaceText: string
  targetUid: string
  targetKind: 'glossary' | 'model'
  displayMode: SemanticDisplayMode
  relationType: SemanticRelationType
  status: 'candidate' | 'approved' | 'rejected'
  source: 'user' | 'dictionary' | 'morphology' | 'llm'
  confidence?: number | null
}
export interface SemanticDocument {
  uid?: string
  ownerUid: string
  fieldName: string
  originalText: string
  displayText: string
  policy: SemanticPolicy
  references: SemanticReference[]
  history?: Array<{
    uid: string
    beforeText: string
    afterText: string
    method: string
    status: string
    detail: Record<string, unknown>
    createdAt: string
    decidedAt: string | null
  }>
  normalization?: {
    beforeText: string
    afterText: string
    method: 'mechanical' | 'dictionary' | 'llm' | 'user'
    status: 'candidate' | 'approved' | 'rejected' | 'reverted'
    detail?: Record<string, unknown>
  }
}
export interface SemanticCandidate {
  uid: string
  code: string
  title: string
  kind: 'glossary' | 'model'
  status: string
  definition: string | null
  category: string | null
  matchedText: string
  scope: string
  deprecated: number
  versionTag?: string | null
  accessLevel?: string
}
export const SEMANTIC_RELATIONS: SemanticRelationType[] = [
  'relates_to',
  'based_on',
  'satisfies',
  'allocated_to',
  'verifies',
  'contains',
  'implements',
  'uses',
  'calls',
  'conflicts_with'
]
