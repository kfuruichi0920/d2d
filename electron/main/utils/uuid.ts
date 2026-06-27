import { v7 as uuidv7 } from 'uuid'

export function generateUid(): string {
  return uuidv7()
}

export function isValidUid(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
