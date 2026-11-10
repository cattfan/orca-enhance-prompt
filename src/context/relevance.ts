// Finds files relevant to a prompt: keywords from the prompt, path scoring, grep hits and
// recently changed files. Pure except for the grep the caller passes in.

const STOP = new Set(
  (
    'the a an and or for with from into onto this that these those then than when where what which who how why ' +
    'add fix make update change create remove delete use using please need want should could would can will ' +
    'not all any some more less new old get set put run test tests code file files function page bug issue ' +
    'have has had are was were been be is it its to of in on at by as do does done so if else also just like ' +
    'cho của và với các những một này kia đó khi thì là được không có để trong ngoài lên xuống sửa thêm xoá xóa ' +
    'làm giúp mình tôi bạn cái nào gì sao vậy nhé đi rồi lại cần muốn phải nên hãy vào ra trang lỗi chức năng'
  ).split(/\s+/)
)

/** Identifiers, paths and meaningful words from the prompt, most specific first. */
export function extractKeywords(prompt: string, max = 12): string[] {
  return weightedKeywords(prompt, max).map((entry) => entry.word)
}

/** Same, with weights: 5 paths/backticks/dotted names, 4 identifiers/file names, 2 long words, 1 short words. */
export function weightedKeywords(prompt: string, max = 12): { word: string; weight: number }[] {
  const found = new Map<string, number>()
  const add = (word: string, weight: number) => {
    const key = word.toLowerCase()
    if (key.length < 3 || STOP.has(key) || /^\d+$/.test(key)) return
    found.set(key, Math.max(found.get(key) ?? 0, weight))
  }
  for (const match of prompt.matchAll(/`([^`]{2,80})`/g)) add(match[1].trim(), 5)
  for (const match of prompt.matchAll(/[\w@.-]*[/\\][\w@./\\-]+/g)) {
    add(match[0].replace(/\\/g, '/').replace(/^\.\//, ''), 5)
    add(match[0].split(/[/\\]/).pop() ?? '', 4)
  }
  // Dotted names such as `agent.prompt.before` or `user.profile.update`: exact strings to grep for.
  for (const match of prompt.matchAll(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){1,4}\b/g)) {
    if (!/\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|vue|svelte|css|scss|md|json|ya?ml|toml|sql)$/i.test(match[0])) add(match[0], 5)
  }
  for (const match of prompt.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const word = match[0]
    if (/[a-z][A-Z]|_|^[A-Z][a-z]+[A-Z]/.test(word)) {
      add(word, 4)
      for (const part of word.split(/(?=[A-Z])|_/)) add(part, 2)
    } else {
      add(word, word.length >= 6 ? 2 : 1)
    }
  }
  for (const match of prompt.matchAll(/\b\w+\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|vue|svelte|css|scss|md|json|yaml|yml|toml|sql)\b/gi)) {
    add(match[0], 5)
  }
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([word, weight]) => ({ word, weight }))
}

const LOW_VALUE = /(^|\/)(test-fixtures|fixtures|__snapshots__|snapshots|migrations|generated|locales?|i18n)\//i
const TEST_FILE = /(\.|_)(test|spec)\.|(^|\/)tests?\//i

export type Scored = { path: string; score: number; hits: number[] }

/**
 * Content score per file from per-keyword grep counts, weighted like IDF: a keyword found in few
 * files says much more than one found everywhere; a keyword found in more than 20 files and more
 * than 5% of them is ignored.
 */
export function contentScores(
  perWord: Map<string, number>[],
  totalFiles: number,
  weights: number[] = []
): Map<string, number> {
  const scores = new Map<string, number>()
  perWord.forEach((counts, index) => {
    const df = counts.size
    if (df === 0 || df > Math.max(20, totalFiles * 0.05)) return
    const idf = Math.log((totalFiles + 1) / (df + 1))
    const k = keywordFactor(weights[index] ?? 4)
    for (const [file, count] of counts) {
      scores.set(file, (scores.get(file) ?? 0) + k * idf * (1 + Math.log(count)))
    }
  })
  return scores
}

/** How much a keyword of this weight counts: specific names fully, generic words much less. */
export const keywordFactor = (weight: number) => (weight >= 4 ? 1 : weight >= 2 ? 0.6 : 0.35)

export function scoreFiles(
  files: string[],
  keywordList: (string | { word: string; weight: number })[],
  content: Map<string, number>,
  changed: Set<string>,
  promptMentionsTests: boolean
): Scored[] {
  const keywords = keywordList.map((entry) => (typeof entry === 'string' ? { word: entry, weight: 4 } : entry))
  const out: Scored[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const name = lower.split('/').pop() ?? lower
    const stem = name.replace(/\.[^.]+$/, '')
    let score = 0
    for (const { word, weight } of keywords) {
      // A generic word ("agent", "hook") in a path says little; a specific one says a lot.
      const k = keywordFactor(weight)
      if (word.includes('/') && lower.endsWith(word)) score += 12
      else if (name === word) score += 10 * k
      else if (stem === word) score += 8 * k
      else if (stem.includes(word)) score += 4 * k
      else if (lower.includes(`/${word}/`) || lower.startsWith(`${word}/`)) score += 3 * k
      else if (lower.includes(word)) score += 1 * k
    }
    score += Math.min(24, content.get(path) ?? 0)
    if (changed.has(path)) score += score > 0 ? 4 : 1.5
    if (score <= 0) continue
    if (LOW_VALUE.test(path)) score *= 0.4
    if (TEST_FILE.test(path) && !promptMentionsTests) score *= 0.6
    out.push({ path, score, hits: [] })
  }
  return out.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
}
