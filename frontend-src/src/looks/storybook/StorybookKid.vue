<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import KidView from '../../views/KidView.vue'
import './storybookKid.css'

defineProps({ id: String })
const root = ref(null)
let pages = null
let changes = null
let lastPage = ''
let turnTimer = 0
let panelObserver = null
let autoCardsButton = null
let autoCardsInput = null
let syncAutoCards = null
function placeAutoCardsSetting() {
  const input = root.value?.querySelector('.kv-auto-setting input')
  const options = document.querySelector('.kv-panel .kv-reading-options')
  if (!input || !options || options.querySelector('.sb-kid-auto-cards')) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'kv-option sb-kid-auto-cards'
  button.innerHTML = 'Show word cards as they\'re read <span aria-hidden="true"></span>'
  const sync = () => {
    button.setAttribute('aria-pressed', String(input.checked))
    button.querySelector('span').textContent = input.checked ? 'On' : 'Off'
  }
  button.addEventListener('click', () => { input.click(); sync() })
  input.addEventListener('change', sync)
  sync()
  options.append(button)
  autoCardsButton = button
  autoCardsInput = input
  syncAutoCards = sync
}
onMounted(() => {
  document.body.classList.add('sb-kid-active')
  panelObserver = new MutationObserver(placeAutoCardsSetting)
  panelObserver.observe(document.body, { childList: true, subtree: true })
  placeAutoCardsSetting()
  const connect = () => {
    const dots = root.value?.querySelector('.kv-dots')
    if (!dots || dots === pages) return
    pages = dots
    lastPage = dots.getAttribute('aria-label') || ''
    changes?.disconnect()
    changes = new MutationObserver(() => {
      const label = dots.getAttribute('aria-label') || ''
      if (label === lastPage) return
      lastPage = label
      const page = root.value?.querySelector('.kv-page')
      if (!page) return
      page.classList.remove('sb-kid-turn')
      void page.offsetWidth
      page.classList.add('sb-kid-turn')
      clearTimeout(turnTimer)
      turnTimer = setTimeout(() => page.classList.remove('sb-kid-turn'), 520)
    })
    changes.observe(dots, { attributes: true, attributeFilter: ['aria-label'] })
  }
  const ready = new MutationObserver(connect)
  ready.observe(root.value, { childList: true, subtree: true })
  connect()
  readyObserver = ready
})
let readyObserver = null
onBeforeUnmount(() => {
  document.body.classList.remove('sb-kid-active')
  readyObserver?.disconnect()
  changes?.disconnect()
  panelObserver?.disconnect()
  autoCardsInput?.removeEventListener('change', syncAutoCards)
  autoCardsButton?.remove()
  clearTimeout(turnTimer)
})
</script>

<template>
  <div ref="root" class="sb-kid">
    <KidView :id="id" />
    </div>
</template>
