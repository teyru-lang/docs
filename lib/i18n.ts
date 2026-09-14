import type { I18nProviderProps } from 'fumadocs-ui/contexts/i18n';

/**
 * Fumadocs ships its UI strings in English. The documentation is written in
 * Traditional Chinese, so the strings a reader actually sees are translated
 * here. Anything missing stays English rather than being guessed at.
 *
 * Keys come from `fumadocs-ui/.translations/keys`; see the Fumadocs i18n docs.
 */
export const translations: I18nProviderProps['translations'] = {
  // Search
  'Search(search trigger)': '搜尋',
  'Search(search dialog)': '搜尋',
  'Open Search(search trigger)(aria-label)': '開啟搜尋',
  'Close Search(search dialog)(aria-label)': '關閉搜尋',
  'No results found(search dialog)': '沒有符合的結果',

  // Table of contents
  'On this page(table of contents)': '本頁內容',
  'No Headings(table of contents)': '沒有標題',
  'Table of Contents(inline table of contents)': '目錄',

  // Pagination and page footer
  'Previous Page(pagination)': '上一頁',
  'Next Page(pagination)': '下一頁',
  'Last updated on(page footer)': '最後更新於',

  // Page actions
  'Edit on GitHub(edit page)': '在 GitHub 上編輯',
  'Copy Markdown(page actions)': '複製 Markdown',
  'View as Markdown(page actions)': '以 Markdown 檢視',
  'Open(page actions)': '開啟',
  'Open in GitHub(page actions)': '在 GitHub 開啟',

  // Code blocks
  'Copy Text(code block)(aria-label)': '複製程式碼',
  'Copied Text(code block)(aria-label)': '已複製',

  // Sidebar
  'Open Sidebar(sidebar)(aria-label)': '開啟側邊欄',
  'Close Sidebar(sidebar)(aria-label)': '關閉側邊欄',
  'Collapse Sidebar(sidebar)(aria-label)': '收合側邊欄',
  'Show Sidebar(sidebar)': '顯示側邊欄',
  'Hide Sidebar(sidebar)': '隱藏側邊欄',
  'Toggle Menu(home layout header)(aria-label)': '切換選單',

  // Theme
  'Toggle Theme(theme switcher)(aria-label)': '切換主題',
  'Light(theme switcher)(aria-label)': '淺色',
  'Dark(theme switcher)(aria-label)': '深色',
  'System(theme switcher)(aria-label)': '跟隨系統',

  // 404
  'Page Not Found(404 not found page)': '找不到頁面',
  'Back to Home(404 not found page)': '回到首頁',
  'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)':
    '您要尋找的頁面可能已被移除、更名，或暫時無法使用。',

  // Type tables
  'Type(type table)': '型別',
  'Default(type table)': '預設值',
  'Parameters(type table)': '參數',
  'Returns(type table)': '回傳',
  'Prop(type table)': '屬性',
};
