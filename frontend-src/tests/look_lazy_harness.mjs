import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guard, behavior, finish } from './_kinds.mjs'
import { resolveLook } from '../src/looks/index.js'

const source = readFileSync(new URL('../src/looks/index.js', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const id = 'sample-id'
const look = (name, screen) => resolveLook({ name: 'look', look: name, screen, id })
const routes = ['sharpened', 'newer', 'storybook', 'palette', 'sound']

for (const name of routes) {
  for (const screen of ['library', 'p', 'kid']) {
    guard(`${name} ${screen} resolves to a lazy component`, () => {
      const vnode = look(name, screen)
      if (typeof vnode.type?.__asyncLoader !== 'function') throw new Error('No async component loader')
      if ((screen === 'p' || screen === 'kid') && name !== 'sharpened' && vnode.props?.id !== id && name !== 'storybook') {
        throw new Error('Passage id not passed to look screen')
      }
    })
  }
}

behavior('each look screen has its own component', () => {
  for (const name of ['newer', 'storybook', 'palette', 'sound']) {
    const types = ['library', 'p', 'kid'].map(screen => look(name, screen).type)
    if (new Set(types).size !== 3) throw new Error(`${name} screens overlap`)
  }
  if (new Set(['newer', 'storybook', 'palette', 'sound'].map(name => look(name, 'p').type)).size !== 4) {
    throw new Error('Looks share a reader component')
  }
})

guard('unknown looks and screens fall back to Sharpened', () => {
  const fallback = look('sharpened', 'p').type
  for (const route of [
    { name: 'look', look: 'unknown', screen: 'p', id },
    { name: 'look', look: 'sound', screen: 'other', id },
  ]) {
    const vnode = resolveLook(route)
    if (vnode.type !== fallback || vnode.props?.route !== route) throw new Error(`Fallback changed for ${route.look}/${route.screen}`)
  }
})

// Which page #/looks shows is a design choice (today: the chooser for all looks), so it is reported, not guarded.
behavior('the comparison route opens a page other than a look reader', () => {
  const vnode = resolveLook({ name: 'looks', look: 'sharpened', screen: 'compare' })
  if (vnode.type === look('sharpened', 'p').type) throw new Error('#/looks still opens the Sharpened reader')
})

guard('look files and dispatcher are imported lazily', () => {
  if (/^import\s+.*from\s+['"].*\.vue['"]/m.test(source)) throw new Error('Eager look import')
  if (!app.includes("import('./looks/index.js')")) throw new Error('App eagerly imports LookShell')
  const paths = [...source.matchAll(/import\('([^']+\.vue)'\)/g)].map(match => match[1])
  for (const path of paths) readFileSync(fileURLToPath(new URL(path, new URL('../src/looks/index.js', import.meta.url))))
})

behavior('current look set has 13 distinct lazy screens', () => {
  const paths = [...source.matchAll(/import\('([^']+\.vue)'\)/g)].map(match => match[1])
  if (paths.length !== 13 || new Set(paths).size !== 13) throw new Error(`Expected 13 distinct lazy screens, found ${paths.length}`)
})

finish()
