// The themes on one page: which exist, and the address of each screen in each. A reader switches theme and stays on
// the same story and screen. Classic is the app's own screens; the rest live under #/look/<id>/.
export const THEMES = [
  { id: 'mix', name: 'Signature', swatch: 'linear-gradient(135deg, #007693 50%, #f9f2a4 50%)' },
  { id: 'palette', name: 'ReadWorks', swatch: '#007693' },
  { id: 'sharpened', name: 'Crisp', swatch: '#344048' },
  { id: 'newer', name: 'Bright', swatch: 'linear-gradient(95deg, #1c3b49, #007693)' },
  { id: 'storybook', name: 'Storybook', swatch: '#e8dfc8' },
  { id: 'sound', name: 'Soundwave', swatch: 'repeating-linear-gradient(90deg, #007693 0 3px, #d7f5ff 3px 6px)' },
  { id: 'classic', name: 'Classic', swatch: '#f5f8f8' },
]
export const DEFAULT_THEME = 'mix'
export const SCREENS = [
  { id: 'library', name: 'Stories' },
  { id: 'p', name: 'Read' },
  { id: 'kid', name: 'Kid view' },
]

export function themeHref(theme, screen, id) {
  if (theme === 'classic') return screen === 'library' || !id ? '#/classic' : `#/${screen}/${id}`
  return screen === 'library' || !id ? `#/look/${theme}/` : `#/look/${theme}/${screen}/${id}`
}

// route -> { theme, screen, id }, or null on a screen that has no themes (review, listening test, teacher).
export function placeOf(r) {
  if (r.name === 'look') return { theme: r.look, screen: r.screen, id: r.id }
  if (r.name === 'looks') return { theme: DEFAULT_THEME, screen: 'library' }
  if (r.name === 'library' && !r.teacher) return { theme: 'classic', screen: 'library' }
  if (r.name === 'passage') return { theme: 'classic', screen: 'p', id: r.id }
  if (r.name === 'kid') return { theme: 'classic', screen: 'kid', id: r.id }
  return null
}
