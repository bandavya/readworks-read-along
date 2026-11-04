// Focused mode: one simple reader that looks like a ReadWorks page, on by default.
// "All features" brings back the themes and extra reading tools, for people comparing ideas.
import { ref } from 'vue'

const KEY = 'rwp-focused-mode'

function saved() {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export const focused = ref(saved())

export function setFocused(on) {
  focused.value = on
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* the choice lasts for this page only */ }
}
