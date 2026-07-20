/** Resource種別の画面表示名（sdd_data_structure §4.6）。 */
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  resource_label: 'ラベル',
  resource_text: 'テキスト',
  resource_list: 'リスト',
  resource_figure: '図',
  resource_table: '表',
  resource_formula: '数式',
  resource_code: 'コード',
  resource_model: 'モデル',
  resource_reference: '参照'
}
export function resourceTypeLabel(type?: string): string {
  return type ? (RESOURCE_TYPE_LABELS[type] ?? type) : '未設定'
}
