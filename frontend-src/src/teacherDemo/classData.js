// Fictional Class 4B. No real child or reading event appears here.
export const PASSAGE_ID = '5be861ea-8e68-4f42-abcf-2be4a46d82d5'
export const PASSAGE_TITLE = 'Lionel Messi'
export const GROUPS = {
  sunrise: { name: 'Sunrise', settings: { vocabAutoShow: true, textSize: 'L' } },
  river: { name: 'River', settings: { font: 'sans', spacing: true } },
  oak: { name: 'Oak', settings: { textSize: 'L' } },
}
const roster = [
  ['Aaliyah Brooks', 'not started', 0], ['Amir Reed', 'finished', 3],
  ['Ava Chen', 'finished', 3], ['Ben Carter', 'finished', 3],
  ['Camila Torres', 'finished', 3], ['Diego Ruiz', 'finished', 3],
  ['Ella Morgan', 'finished', 3], ['Ethan Clark', 'finished', 3],
  ['Fatima Ali', 'not started', 0], ['Gabriel Hall', 'finished', 3],
  ['Hana Park', 'finished', 3], ['Isaac Bell', 'finished', 3],
  ['Jasmine Lee', 'finished', 3], ['Jordan Ellis', 'finished', 3],
  ['Kai Bennett', 'finished', 3], ['Lena Ortiz', 'finished', 3],
  ['Leo Grant', 'in progress', 2], ['Maya Patel', 'finished', 3],
  ['Mia Flores', 'finished', 3], ['Noah Price', 'finished', 3],
  ['Olivia Shah', 'stopped early', 1], ['Owen Brooks', 'finished', 3],
  ['Paige Nair', 'not started', 0], ['Rafael Soto', 'audio trouble', 0],
  ['Sofia Kim', 'finished', 3], ['Zoe Rivera', 'finished', 3],
]
export const STUDENTS = roster.map(([name, status, audioLevel], i) => ({
  id: name.split(' ')[0].toLowerCase(), name,
  groupId: name.startsWith('Maya ') ? 'sunrise' : name.startsWith('Diego ') ? 'river' : name.startsWith('Jordan ') ? 'oak' : ['sunrise', 'river', 'oak'][i % 3],
  status, opened: status !== 'not started', audioLevel,
  ...(name.startsWith('Jordan ') ? { locks: { soundOn: true } } : {}),
  ...(name.startsWith('Maya ') ? { settings: { spacing: true }, choice: { textSize: 'XL' } } : {}),
}))
export const ASSIGNMENT = {
  id: 'class4b-messi', passageId: PASSAGE_ID, title: PASSAGE_TITLE,
  classSettings: { soundOn: true, voice: 'human', textSize: 'M', contrast: false },
  adjustable: { voice: true, textSize: true },
}
// Pooled synthetic counts; the displayed sentences come from the assigned passage.
export const CLASS_WORDS = [
  { word: 'determined', students: 7, sentence: 'He was fast, determined, and hard-hitting on the soccer field.' },
  { word: 'victory', students: 5, sentence: 'He became more and more famous and admired as he helped his teams in Spain win victory after victory.' },
  { word: 'academy', students: 4, sentence: 'Lionel was so good that a soccer training academy in Spain took notice.' },
  { word: 'foundation', students: 3, sentence: 'He also has a charity foundation.' },
]
