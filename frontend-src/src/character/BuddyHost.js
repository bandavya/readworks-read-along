// Puts the chosen reading buddy on whichever reader is on screen, in any theme, without the reader knowing. Off by
// default; when it is off this does nothing at all. The reader's engine is found the way ThemeBar finds it.
import { defineComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import { SoundAlong } from '../soundAlong'
import { route } from '../router'
import { runBuddy } from './buddyDriver.js'
import { buddyDef, buddyChoice, mouthStyle } from './buddies.js'

export default defineComponent({
  name: 'BuddyHost',
  setup() {
    let stop = null
    let engine = null
    let chosen = null
    const drop = () => { stop?.(); stop = null; engine = null; chosen = null }
    async function check() {
      const wanted = buddyChoice.value
      const live = SoundAlong.latest
      const ready = live?.container?.isConnected && live.order?.length
      if (!wanted || !ready) { if (stop) drop(); return }
      if (engine === live && chosen === wanted) return
      drop()
      engine = live
      chosen = wanted
      const def = await buddyDef(wanted)
      if (engine !== live || chosen !== wanted || !def) return
      stop = runBuddy(live, def, { kid: route.value.screen === 'kid' || route.value.name === 'kid', mouthStyle: () => mouthStyle.value })
    }
    let timer = 0
    onMounted(() => { timer = setInterval(check, 250); check() })
    watch(buddyChoice, check) // a switch shows straight away
    onBeforeUnmount(() => { clearInterval(timer); drop() })
    return () => null
  },
})
