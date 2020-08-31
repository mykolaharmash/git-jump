import {Writable} from 'stream'
import { execSync } from 'child_process'
import {readdirSync, fstat, writeFile, readFileSync, appendFileSync} from 'fs'
import { parseKeys } from './parseKeys'
import { fuzzyMatch } from './fuzzy'


// Sub-commands

function isSubCommand(name: string): boolean {
  return ['init', 'list', 'new'].includes(name)
}

function executeSubCommand(name: string, args: string[]) {
  switch (name) {
    case 'init': {
      init(args)
      break
    }
    case 'list': {
      list(args)
      break
    }
    case 'new': {
      create(args)
      break
    }
    default: {
      throw new Error(`Unknown sub-command ${name}`)
    }
  }
}

function init(args: string[]) {
  console.log('init sub-command')
}

function list(args: string[]) {
  console.log('list sub-command')
}

function create(args: string[]) {
  console.log('new sub-command')
}


// Bare

interface BranchData {
  name: string
  lastSwitch: number
}

interface CurrentHEAD {
  detached: boolean
  sha: string | null
  branchName: string | null
}

enum ListLineType {
  Head,
  Branch
}

interface ListLine {
  type: ListLineType,
  content: CurrentHEAD | BranchData,
  searchMatchScore: number
}

interface State {
  rows: number
  highlightedLineIndex: number
  maxRows: number
  branches: BranchData[]
  searchString: string
  searchStringCursorPosition: number
  currentHEAD: CurrentHEAD,
  list: ListLine[]
}

const state: State = {
  rows: process.stdout.rows,
  highlightedLineIndex: 0,
  maxRows: process.stdout.rows,
  branches: [],
  searchString: '',
  searchStringCursorPosition: 0,
  currentHEAD: {
    detached: false,
    sha: null,
    branchName: null
  },
  list: []
}

function relativeDateTime(timestamp: number) {
  // const date = new Date(timestamp)
  const ONE_MINUTE = 60
  const ONE_HOUR = ONE_MINUTE * 60
  const ONE_DAY = ONE_HOUR * 24

  const now = Date.now()
  const delta = Math.round((now - timestamp) / 1000)

  // TODO: handle singular and plural forms
  if (delta < ONE_MINUTE) {
    return `${delta} seconds`
  }

  if (delta < ONE_HOUR) {
    return `${Math.round(delta / ONE_MINUTE)} minutes`
  }

  if (delta < ONE_DAY) {
    return `${Math.round(delta / ONE_HOUR)} hours`
  }

  return `${Math.round(delta / ONE_DAY)} days`
}

function dim(s: string): string {
  if (s === '') {
    ''
  }

  return `\x1b[2m${s}\x1b[22m`
}

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[22m`
}

function highlight(s: string): string {
  return `\x1b[38;5;4m${s}\x1b[39m`
}

interface LinesWindow {
  topIndex: number
  bottomIndex: number
}

function calculateLinesWindow(linesCount: number, highlightedLineIndex: number): LinesWindow {
  const windowSize = state.rows - 2
  const windowHalf = Math.floor(windowSize / 2)

  const topIndex = Math.max(
    0, 
    Math.min(
      linesCount - windowSize, 
      state.highlightedLineIndex - windowHalf
    )
  )
  const bottomIndex = topIndex + (windowSize - 1)

  return { topIndex, bottomIndex }
}

// Views

const branchIndexPadding = '   '



function viewCurrentHEAD(currentHEAD: CurrentHEAD): string {
  if (!currentHEAD.detached) {
    return `${branchIndexPadding}${bold(currentHEAD.branchName)}`
  }

  return `${branchIndexPadding}${bold(currentHEAD.sha)} ${dim('(detached)')}`
}

function viewBranch(branch: BranchData, index: number): string {
  const timeAgo = branch.lastSwitch !== 0 ? relativeDateTime(branch.lastSwitch) : ''

  return ` ${dim(index.toString())} ${branch.name} ${dim(timeAgo)}`
}

function viewList(state: State): string[] {
  if (state.list.length === 0) {
    return []
  }

  let list: string[] = []
  let nonCurrentBranches: ListLine[]

  if (state.list[0].type === ListLineType.Head) {
    list.push(viewCurrentHEAD(state.list[0].content as CurrentHEAD))

    nonCurrentBranches = state.list.slice(1)
  } else {
    nonCurrentBranches = state.list
  }

  list = list.concat(nonCurrentBranches.map((line: ListLine, index: number) => {
    return viewBranch(line.content as BranchData, index)
  }))

  const listWindow = calculateLinesWindow(list.length, state.highlightedLineIndex)

  return list.map((line, index) => {
    return index === state.highlightedLineIndex ? highlight(line) : line
  }).slice(listWindow.topIndex, listWindow.bottomIndex + 1)
}

function viewSearch(state: State): string {
  const SEARCH_PLACEHOLDER = 'Search'
  const search = state.searchString === '' ? dim(SEARCH_PLACEHOLDER) : state.searchString

  return `${branchIndexPadding}${search}`
}

function view(state: State) {
  let lines: string[] = []

  lines.push(viewSearch(state))
  lines = lines.concat(viewList(state))

  render(lines, branchIndexPadding.length + state.searchStringCursorPosition + 1)
}

function render(lines: string[], cursorPosition: number) {  
  // Move to the beginning of the line and clear everything after cursor
  process.stdout.write(`\x1b[1G`)
  process.stdout.write(`\x1b[0J`)

  // Render all the lines
  process.stdout.write(lines.join('\n'))

  // Move cursor back to the first line
  // \x1b[0A will still move one line up, so
  // do not move in case there is only one line
  if (lines.length > 1) {
    process.stdout.write(`\x1b[${lines.length - 1}A`)
  }

  // Move cursor back where user left it
  process.stdout.write(`\x1b[${cursorPosition}G`)
}

const CTRL_C = Buffer.from('03', 'hex')
const UP = Buffer.from('1b5b41', 'hex')
const DOWN = Buffer.from('1b5b42', 'hex')
const DELETE = Buffer.from('7f', 'hex')
const LETTER_g = Buffer.from('g', 'utf8')
const SPACE = Buffer.from('20', 'hex')

function log(s: any) {
  appendFileSync('./log', Buffer.from(`${JSON.stringify(s)}\n`))
}

function readBranchesData() {
  return JSON.parse(readFileSync(`${process.cwd()}/.jump/data.json`).toString())
}

const escapeCode = 0x1b
const UNICODE_C0_RANGE: [Number, Number] = [0x00, 0x1f]
const UNICODE_C1_RANGE: [Number, Number] = [0x80, 0x9f]

function isEscapeCode(data: Buffer): boolean {
  return data[0] === escapeCode
}

function isC0C1ControlCode(data: Buffer): boolean {
  // If key buffer has more then one byte it's not a control character
  if (data.length > 1) {
    return false
  }

  const code = data[0]
  
  const inC0Range = code >= UNICODE_C0_RANGE[0] && code <= UNICODE_C0_RANGE[1]
  const inC1Range = code >= UNICODE_C1_RANGE[0] && code <= UNICODE_C1_RANGE[1]

  return inC0Range || inC1Range
}

function isDeleteKey(data: Buffer) {
  return data.length === 1 && data[0] === DELETE[0]
}

function isSpecialKey(key: Buffer): boolean {
  return isEscapeCode(key) || isC0C1ControlCode(key) || isDeleteKey(key)
}

function readCurrentHEAD(): CurrentHEAD {
  const head = readFileSync('./.git/HEAD').toString()
  const detached = !head.startsWith('ref:')

  return {
    detached,
    sha: detached ? head : null,
    branchName: detached ? null : head.slice(16).trim()
  }
}

enum ListSortCriterion {
  LastSwitch,
  SearchMatchScore
}

function sortedListLines(list: ListLine[], criterion: ListSortCriterion): ListLine[] {
  if (criterion === ListSortCriterion.LastSwitch) {
    return list.slice().sort((a: ListLine, b: ListLine) => {
      if (a.type === ListLineType.Head) {
        return 0
      }

      return (b.content as BranchData).lastSwitch - (a.content as BranchData).lastSwitch
    })
  }

  return list.slice().sort((a: ListLine, b: ListLine) => {
    return b.searchMatchScore - a.searchMatchScore
  })
}

function generateList(state: State) {
  let list: ListLine[] = []

  list.push({ 
    type: ListLineType.Head, 
    content: state.currentHEAD, 
    searchMatchScore: state.searchString === '' ? 1 : fuzzyMatch(state.searchString, state.currentHEAD.detached ? state.currentHEAD.sha : state.currentHEAD.branchName)
  })

  const branchLines: ListLine[] = state.branches
    // Filter out current branch if HEAD is not detached,
    // because current branch will be displayed as the first list
    .filter(branch => {
      return (
        state.currentHEAD.detached
        || branch.name !== state.currentHEAD.branchName
      )
    })
    .map((branch: BranchData) => {
      return { 
        type: ListLineType.Branch, 
        content: branch,
        searchMatchScore: state.searchString === '' ? 1 : fuzzyMatch(state.searchString, branch.name)
      }
    })

  list = list.concat(branchLines).filter((line: ListLine) => {
    return line.searchMatchScore >= 0.5
  })

  // log(list)

  const sortCriterion = state.searchString === '' ? ListSortCriterion.LastSwitch : ListSortCriterion.SearchMatchScore

  return sortedListLines(list, sortCriterion)
}

function bare() {
  const gitBranches = readdirSync('./.git/refs/heads')  
  const branchesData = readBranchesData()

  state.currentHEAD = readCurrentHEAD()
  // log(state.currentHEAD)
  state.branches = gitBranches
    .map(branch => {
      return {
        name: branch,
        lastSwitch: branchesData[branch] !== undefined ? branchesData[branch].lastSwitch : 0,
        score: 1
      }
    })

  
  state.list = generateList(state)
  state.highlightedLineIndex = 0

  // log(state.list)

  view(state)

  process.stdin.setRawMode(true)

  function handleSpecialKey(key: Buffer) {

    // Supported special key codes
    // 1b5b44 - left
    // 1b5b43 - right
    // 1b5b41 - up
    // 1b5b42 - down
    // 1b62 - Option+left, word jump
    // 1b66 - Option+right, word jump
    // 1b4f48, 01 - Cmd+left, Control+a, Home
    // 1b4f46, 05 - Cmd+right, Control+e, End
    // 7f - Delete
    // 1b5b337e - fn+Delete, Forward Delete
    // 1b7f - Option+Delete, delete whole word
    // 17 - Control+w, delete the whole line
    // 0b - Control+k, delete from cursor to the end of the line

    if (key.equals(CTRL_C)) {
      process.stdout.write('\n')
      process.exit()
    }

    if (key.equals(UP)) {
      state.highlightedLineIndex = Math.max(0, state.highlightedLineIndex - 1)
      // calculateBranchesWindow()
      view(state)

      return
    }

    if (key.equals(DOWN)) {
      state.highlightedLineIndex = Math.min(state.list.length - 1, state.highlightedLineIndex + 1)
      // calculateBranchesWindow()
      view(state)

      return
    }

    if (key.equals(DELETE)) {
      if (state.searchString.length === 0) {
        return
      }

      state.searchString = state.searchString.slice(0, state.searchString.length - 1)  
      state.searchStringCursorPosition -= 1
      state.list = generateList(state)
      state.highlightedLineIndex = 0
      view(state)

      return
    }
  }

  function handleStringKey(key: Buffer) {
    const inputString = key.toString()

    state.searchString += inputString
    state.searchStringCursorPosition += inputString.length
    state.list = generateList(state)
    state.highlightedLineIndex = 0
    view(state)
  }

  process.stdin.on('data', (data: Buffer) => {
    // log(data.toString('hex'))

    parseKeys(data).forEach((key: Buffer) => {
      if (isSpecialKey(key)) {
        handleSpecialKey(key)

        return
      }

      handleStringKey(key)
    })
    
  })
}

// Jump to a branch

function jumpTo(args: string[]) {
  console.log('Jumping to a branch')

//   const argsString = args.join(' ')
// const switchCommand = `git switch ${argsString}`

// try {
//   const output = execSync(switchCommand)

//   console.log(output)
// } catch (error) {
//   console.log(error.stderr.toString())
// }

}

function main(args: string[]) {
  if (args.length === 0) {
    bare()

    return
  }

  if (isSubCommand(args[0])) {
    executeSubCommand(args[0], args.slice(1))

    return
  }

  jumpTo(args)  
}

main(process.argv.slice(2))