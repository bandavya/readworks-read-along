// Every data point this kit may keep. Add or remove a line and recording, the
// panel, its CSV and the data sheet (node make_sheet.mjs) all follow.
//   hook        where the host reader calls the kit
//   from        what a person does that produces it
//   helps       what it's useful for
//   cannotTell  what nobody should read into it
//   teacher     sent to the teacher's dashboard, coarsely: 'yes' sends only that it happened; 'level' sends the level.
//               Leave it out and that count never leaves the device. The server keeps its own list of allowed fields.
export const DATA_OPTIONS = [
  {
    id: 'opened', label: 'Times opened', teacher: 'yes', teacherLabel: 'Opened',
    hook: "record('opened', passageId) once a passage has loaded",
    from: 'A passage finishes loading.',
    helps: 'Shows which passages get used on this device.',
    cannotTell: 'Who opened it. A teacher trying a passage counts too.',
  },
  {
    id: 'play_started', label: 'Times play was pressed',
    hook: "record('play_started', passageId) on the narration audio's play event, skipping one-word snippets",
    from: 'Narration starts or resumes.',
    helps: 'Shows whether the audio is being used at all.',
    cannotTell: 'Listening. Each resume after a pause counts again.',
  },
  {
    id: 'reached_end', label: 'Times audio reached the end',
    hook: "record('reached_end', passageId) when narration ends, skipping one-word snippets",
    from: 'Narration plays through its last moment.',
    helps: 'Shows whether readers stay with a passage.',
    cannotTell: 'That anyone was listening, or that the whole passage played. A jump near the end can reach it.',
  },
  {
    id: 'playback', label: 'How much audio played', teacher: 'level', teacherLabel: 'Audio played',
    levels: ['None recorded', 'Partway', 'Significant part', 'Nearly all'], start: [0, 0.5, 0.95],
    hook: 'trackPlayback(audioElement, passageId) once, when the narration audio element is created',
    from: "The browser's own record of which stretches of audio played, in one visit.",
    helps: 'A coarse sign of whether audio is getting used through a passage.',
    cannotTell: 'What a child heard or read. A muted device or an empty seat still counts. Reading with sound off shows nothing.',
  },
  {
    id: 'word_tap', label: 'Word taps', teacher: 'yes', teacherLabel: 'Tapped a word',
    hook: "record('word_tap', passageId) when a tap or key press starts playback from a word",
    from: 'A reader taps a word to hear from there.',
    helps: 'Shows whether tap-to-replay gets used.',
    cannotTell: 'Which word, or whether the reader was stuck. It may be curiosity or jumping around.',
  },
  {
    id: 'replay', label: 'Replays', teacher: 'yes', teacherLabel: 'Replayed',
    hook: "record('replay', passageId) when a reader replays a sentence or restarts the story",
    from: 'A reader replays a sentence or starts the story again.',
    helps: 'Shows whether rereading tools get used.',
    cannotTell: 'Why they replayed, or which sentence. Interest and difficulty look the same.',
  },
  {
    id: 'word_card_opened', label: 'Word cards a reader opened', teacher: 'yes', teacherLabel: 'Used word help',
    hook: "record('word_card_opened', passageId) when a reader opens a word's meaning; never for automatic cards",
    from: 'A reader asks for the meaning of a word.',
    helps: 'Shows whether word help gets used.',
    cannotTell: 'Which word, or that the reader did not know it.',
  },
  {
    id: 'audio_trouble', label: "Times audio wouldn't play", teacher: 'yes', teacherLabel: "Audio wouldn't play",
    hook: 'Comes with trackPlayback; no separate hook',
    from: 'The browser reports that the narration failed, for example when a school network blocks it.',
    helps: 'Separates a technical problem from a reader who chose not to listen.',
    cannotTell: 'Why it failed. Muted sound or missing headphones do not show up.',
  },
]
