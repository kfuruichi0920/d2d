import { describe, expect, it, vi } from 'vitest'
import { runSourceImport } from './source-import'

describe('runSourceImport', () => {
  it('選択された原本をすべて取込Jobへ登録する', async () => {
    const notify = vi.fn()
    const importFile = vi.fn(async () => ({ ok: true }))
    const count = await runSourceImport({ selectFiles: async () => ['a.docx', 'b.pdf'], importFile, notify })
    expect(count).toBe(2)
    expect(importFile).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledWith('info', '2件の原本取込Jobを登録しました')
  })

  it('選択が空ならJobを登録しない', async () => {
    const notify = vi.fn()
    const importFile = vi.fn(async () => ({ ok: true }))
    expect(await runSourceImport({ selectFiles: async () => [], importFile, notify })).toBe(0)
    expect(importFile).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('失敗件数を通知し成功件数を返す', async () => {
    const notify = vi.fn()
    const importFile = vi.fn(async (filePath: string) => ({ ok: filePath !== 'bad.pdf' }))
    expect(await runSourceImport({ selectFiles: async () => ['ok.docx', 'bad.pdf'], importFile, notify })).toBe(1)
    expect(notify).toHaveBeenCalledWith('error', '1件の取込Jobを登録できませんでした')
  })
})
