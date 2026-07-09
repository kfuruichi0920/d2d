/**
 * JSON Schema 検証基盤（P1-5、NFR-033）。
 * ワーカーI/O・LLM構造化出力・候補セット・設定ファイルのスキーマをここへ集約する。
 */
import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { BackendError } from '../api/errors'
import projectD2dSchema from './project-d2d.schema.json'

const ajv = new Ajv({ allErrors: true, strict: true })
addFormats(ajv)

ajv.addSchema(projectD2dSchema)

export type SchemaId = 'd2d://schemas/project-d2d'

/** スキーマ検証し、違反があれば validation エラー契約で例外を投げる */
export function validateSchema<T>(schemaId: SchemaId, data: unknown, subject: string): T {
  const validate = ajv.getSchema(schemaId) as ValidateFunction<T> | undefined
  if (!validate) {
    throw new BackendError('internal', `スキーマが未登録です: ${schemaId}`, '')
  }
  if (!validate(data)) {
    const detail = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join('; ')
    throw new BackendError('validation', `${subject} がスキーマに適合しません`, detail)
  }
  return data
}
