// One entry for every experimental look: route.look picks the look, route.screen the screen (library / p / kid).
// #/looks opens a theme library; the theme bar above every screen does the choosing. Unknown looks fall through to Sharpened.
import { defineAsyncComponent, h } from 'vue'
import { focused } from '../focused.js'

const loadingComponent = { render: () => h('p', { role: 'status', 'aria-live': 'polite' }, 'Opening…') }
const errorComponent = {
  render: () => h('div', { role: 'alert' }, [
    h('p', 'This look could not open.'),
    h('button', { type: 'button', style: { minWidth: '44px', minHeight: '44px' }, onClick: () => window.location.reload() }, 'Try again'),
  ]),
}
const lazyLook = (loader) => defineAsyncComponent({ loader, loadingComponent, errorComponent, delay: 0 })

const Sharpened = lazyLook(() => import('./sharpened/Sharpened.vue'))
const Newer = lazyLook(() => import('./newer/Newer.vue'))
const NewerKid = lazyLook(() => import('./newer/NewerKid.vue'))
const NewerLibrary = lazyLook(() => import('./newer/NewerLibrary.vue'))
const Storybook = lazyLook(() => import('./storybook/Storybook.vue'))
const StorybookKid = lazyLook(() => import('./storybook/StorybookKid.vue'))
const StorybookLibrary = lazyLook(() => import('./storybook/StorybookLibrary.vue'))
const Palette = lazyLook(() => import('./palette/Palette.vue'))
const PaletteKid = lazyLook(() => import('./palette/PaletteKid.vue'))
const PaletteLibrary = lazyLook(() => import('./palette/PaletteLibrary.vue'))
const SoundReader = lazyLook(() => import('./sound/SoundReader.vue'))
const SoundKid = lazyLook(() => import('./sound/SoundKid.vue'))
const SoundLibrary = lazyLook(() => import('./sound/SoundLibrary.vue'))
const MixReader = lazyLook(() => import('./mix/MixReader.vue'))
const MixKid = lazyLook(() => import('./mix/MixKid.vue'))
const MixLibrary = lazyLook(() => import('./mix/MixLibrary.vue'))

export function resolveLook(r) {
  if (r.name === 'looks' || r.screen === 'compare') return h(PaletteLibrary)
  if (r.name === 'look' && r.look === 'mix') {
    if (r.screen === 'p') return h(MixReader, { id: r.id, key: `mix:p:${r.id}:${focused.value}` })
    if (r.screen === 'kid') return focused.value ? h(MixReader, { id: r.id, kid: true, key: `mix:article-kid:${r.id}` }) : h(MixKid, { id: r.id, key: `mix:kid:${r.id}` })
    return h(MixLibrary)
  }
  if (r.name === 'look' && r.look === 'palette' && r.screen === 'p') return h(Palette, { id: r.id })
  if (r.name === 'look' && r.look === 'palette' && r.screen === 'kid') return h(PaletteKid, { id: r.id })
  if (r.name === 'look' && r.look === 'palette' && r.screen === 'library') return h(PaletteLibrary)
  if (r.name === 'look' && r.look === 'newer') {
    if (r.screen === 'p') return h(Newer, { id: r.id })
    if (r.screen === 'kid') return h(NewerKid, { id: r.id })
    return h(NewerLibrary)
  }
  if (r.name === 'look' && r.look === 'storybook') {
    if (r.screen === 'kid') return h(StorybookKid, { id: r.id, key: `storybook:kid:${r.id}` })
    if (r.screen === 'library') return h(StorybookLibrary, { key: 'storybook:library' })
    return h(Storybook, { route: r, key: `storybook:p:${r.id}` })
  }
  if (r.name === 'look' && r.look === 'sound') {
    if (r.screen === 'p') return h(SoundReader, { id: r.id, key: `sound:p:${r.id}` })
    if (r.screen === 'kid') return h(SoundKid, { id: r.id, key: `sound:kid:${r.id}` })
    if (r.screen === 'library') return h(SoundLibrary, { key: 'sound:library' })
    return h(Sharpened, { route: r })
  }
  return h(Sharpened, { route: r })
}

export default {
  name: 'LookShell',
  props: { route: { type: Object, required: true } },
  setup(props) {
    return () => resolveLook(props.route)
  },
}
