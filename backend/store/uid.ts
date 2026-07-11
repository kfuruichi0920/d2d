import { v7 as uuidv7 } from 'uuid'

/** 内部不変ID。UUIDv7 形式の TEXT（sdd_data_structure §1） */
export function newUid(): string {
  return uuidv7()
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
