// Kid view helpers: the spoken-clip player and the data it reads.
// Clips are Polly voice, NOT reviewed by a person (prototype only).
import { assetUrl } from './api'

let kidAudioPromise = null
export function loadKidAudio() {
  if (!kidAudioPromise) {
    kidAudioPromise = fetch(assetUrl('data/kid_audio.json'))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return kidAudioPromise
}

export function loadGloss(id) {
  return fetch(assetUrl(`data/gloss/${id}.json`))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
}

// One <audio> for every spoken clip in the kid view (prompts, definitions, word cards).
// play([urls]) cancels whatever was speaking and plays the list in order. It resolves true when the
// whole list finished, false if it was cut off or the browser refused (then `blocked` is true).
export class ClipVoice {
  constructor() {
    this.a = new Audio()
    this.token = 0
    this.blocked = false
    this.speaking = false
    this._end = null
    this.onChange = () => {}
  }

  _set(on) {
    if (this.speaking !== on) {
      this.speaking = on
      this.onChange(on)
    }
  }

  stop() {
    this.token++
    this.a.pause()
    this._set(false)
    if (this._end) {
      const f = this._end
      this._end = null
      f(false)
    }
  }

  async play(urls) {
    this.stop()
    const t = this.token
    const list = urls.filter(Boolean)
    if (!list.length) return false
    this._set(true)
    for (const u of list) {
      if (t !== this.token) return false
      const ok = await this._one(u)
      if (!ok || t !== this.token) {
        if (t === this.token) this._set(false)
        return false
      }
    }
    if (t === this.token) this._set(false)
    return t === this.token
  }

  _one(url) {
    return new Promise((resolve) => {
      const a = this.a
      let done = false
      const finish = (v) => {
        if (done) return
        done = true
        a.removeEventListener('ended', onEnd)
        a.removeEventListener('error', onErr)
        this._end = null
        resolve(v)
      }
      const onEnd = () => finish(true)
      const onErr = () => finish(false)
      this._end = finish
      a.addEventListener('ended', onEnd)
      a.addEventListener('error', onErr)
      a.src = assetUrl(url)
      const p = a.play()
      if (p && p.catch) {
        p.catch((e) => {
          if (e && e.name === 'NotAllowedError') this.blocked = true
          finish(false)
        })
      }
    })
  }
}

// Syllable guide data: { senseId: { word, syllables, stress_index, audio, whole_segments, slow_phases, ... } }
export function loadSyllables(id) {
  return fetch(assetUrl(`data/syllables/${id}.json`))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
}
