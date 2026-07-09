import { describe, expect, it, vi } from 'vitest'
import { executeCommand, listCommands, matchKeybinding, registerCommand, type CommandContext } from './command-registry'

const ctx: CommandContext = {
  workMode: 'M0',
  hasProject: false,
  activeResourceUri: null,
  isJobRunning: false,
  hasDirtyEditor: false
}

function kbEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: '', ctrlKey: false, shiftKey: false, altKey: false, ...init } as KeyboardEvent
}

describe('command-registry（P3-2）', () => {
  it('Command の登録・一覧・実行ができる', async () => {
    const run = vi.fn()
    const off = registerCommand({ id: 'test.hello', title: 'Hello', run })
    expect(listCommands().some((c) => c.id === 'test.hello')).toBe(true)
    await executeCommand('test.hello', undefined, ctx)
    expect(run).toHaveBeenCalledTimes(1)
    off()
    expect(listCommands().some((c) => c.id === 'test.hello')).toBe(false)
  })

  it('isEnabled=false の Command は Context 付き実行でスキップされる（UI-024）', async () => {
    const run = vi.fn()
    const off = registerCommand({
      id: 'test.needsProject',
      title: 'NeedsProject',
      isEnabled: (c) => c.hasProject,
      run
    })
    await executeCommand('test.needsProject', undefined, ctx)
    expect(run).not.toHaveBeenCalled()
    await executeCommand('test.needsProject', undefined, { ...ctx, hasProject: true })
    expect(run).toHaveBeenCalledTimes(1)
    off()
  })

  it('二重登録は拒否する', () => {
    const off = registerCommand({ id: 'test.dup', title: 'Dup', run: () => {} })
    expect(() => registerCommand({ id: 'test.dup', title: 'Dup2', run: () => {} })).toThrow(/already registered/)
    off()
  })

  it('matchKeybinding が修飾キーとキーを照合する', () => {
    expect(matchKeybinding('Ctrl+Shift+P', kbEvent({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(matchKeybinding('Ctrl+Shift+P', kbEvent({ key: 'p', ctrlKey: true }))).toBe(false)
    expect(matchKeybinding('Ctrl+1', kbEvent({ key: '1', ctrlKey: true }))).toBe(true)
    expect(matchKeybinding('Ctrl+1', kbEvent({ key: '1' }))).toBe(false)
    expect(matchKeybinding('Ctrl+\\', kbEvent({ key: '\\', ctrlKey: true }))).toBe(true)
    expect(matchKeybinding('Ctrl+B', kbEvent({ key: 'b', ctrlKey: true }))).toBe(true)
  })
})
