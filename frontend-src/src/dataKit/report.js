// Sends one student's coarse progress on one assignment. The host supplies `send`, and the student's key from its own
// sign-in or roster. Only options with a `teacher` mark, and only for the assigned passage. Values only rise, so a
// resend is safe and the server can merge by keeping the highest.
export function createReporter({ options, assignmentId, passageId, studentKey, send, wait = 3000, retry = 30000 }) {
  const progress = {}
  let timer = 0
  let dirty = false

  async function flush() {
    clearTimeout(timer)
    timer = 0
    if (!dirty) return
    dirty = false
    try { await send({ assignmentId, studentKey, progress: { ...progress } }) }
    catch {
      dirty = true
      timer = setTimeout(flush, retry)
    }
  }
  globalThis.addEventListener?.('pagehide', flush)

  return {
    note(id, value, forPassage) {
      const option = options.find((o) => o.id === id)
      if (!option?.teacher || forPassage !== passageId) return
      const next = option.teacher === 'level' ? value : 1
      if ((progress[id] ?? 0) >= next) return
      progress[id] = next
      dirty = true
      if (!timer) timer = setTimeout(flush, wait)
    },
    flush,
  }
}
