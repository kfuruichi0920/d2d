/** 空タブを一意なURIで開く（P3-1、UI-057）。 */
import { useEditorStore } from '../stores/editor-store'

export function openEmptyTab(groupId?: number): void {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  useEditorStore.getState().openResource(`empty://${unique}`, '新しいタブ', { preview: false, groupId })
}
