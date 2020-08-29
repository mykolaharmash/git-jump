import {Writable} from 'stream'
import { execSync } from 'child_process'
import {readdirSync, fstat, writeFile, readFileSync, appendFileSync} from 'fs'
import { parseKeys } from './parseKeys'


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

interface State {
  highlightedBranch: number
  branchesScrollWindow: [number, number]
  maxRows: number
  branches: BranchData[]
  searchString: string
  searchStringCursorPosition: number
}

const WINDOW_SIZE = process.stdout.rows - 3
const state: State = {
  highlightedBranch: 0,
  branchesScrollWindow: [0, WINDOW_SIZE - 1],
  maxRows: process.stdout.rows,
  branches: [],
  searchString: '',
  searchStringCursorPosition: 0
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

function fuzzyMatch(search: string, target: string): number {
  const searchChars = search.split('')
  const matches = {} as any
  const matchIndexes = searchChars
    .map(char => {
      const previousMatch = matches[char] === undefined ? -1 : matches[char]
      const index = target.indexOf(char, previousMatch + 1)

      matches[char] = index

      return index
    })
    .filter(index => index !== -1)

  let score = 0
  let continuityMultiplier = 1

  for(let i = 0; i < matchIndexes.length; i++) {
    const charDistance = i === 0 ? 0 : matchIndexes[i] - matchIndexes[i - 1]
    const orderMultiplier = charDistance < 0 ? 0 : 1
    const prefixBonus = Math.max(0, (3 - matchIndexes[i]) / 3)

    continuityMultiplier = charDistance === 1 ? continuityMultiplier + 1 : 1

    score += (continuityMultiplier + prefixBonus) * orderMultiplier
  }

  const maxScore = (search.length * (search.length + 1) / 2) + 2

  return score / maxScore

  // some-branch-name
  // should match:
  // - partial match
  // some
  // 0 1 2 3 = 3
  // soem
  // 0 1 3 2 = 1 + 2 + 1 = 4
  // somb = 0 1 2 5 = 1 + 1 + 3 = 5
  // sbn = 0 5 8 = 5 + 3 = 8
  // bch = 5 9 10 = 4 + 1 = 5
  // hbr = 10 5 6 = 5 + 1 = 6
  // brh = 5 6 10 = 1 + 4 = 5


  // tolerance to transpositions
  // some - 0 1 2 3 = 3 / 3 = 1, 1 - 1 = 0
  // soem - 0 1 3 2 = 1 + 2 + (-1) = 1 + 2 + 1 = 4 / 3 = 1.33, 1 - 1.33 = -0.33
  // osem - 1 0 3 2 = (-1) + 3 + (-1) = 1 + 3 + 1 = 5 / 3 = 1.66, 1 - 1.66 = -0.66
  // eoms = 3 1 2 0 = (-2) + 1 + (-2) = 1 = 0.33, 1 - 0.33 = 0.67

  // ma
  // soma - 2 2
  // main - 0 0

  // someh - 3 / 5 = 0.6, 1 - 0.6 = 0.4
  // something - 3 / 9 = 0.33, 1 - 0.33 = 0.67
  // some-branch-name - 16 / 16 = 1, 1 - 1 = 0
  // mehb - 2 3 10 5 = 1 + 7 + (-5)^2 = 33 / 16 = 2.06, 1 - 2.06 = abs(-1.06) = 1.06
  // mehb - 2 3 10 5 = 1^2 + 7^2 + (-5)^2 = 1 + 49 + 25 = 75


  // s111t1111e
  // se = 0 9 - 9
  // ste = 0^2 + 4^2 + 9^2 = 97
  // ets = 9 4 0 = -5^2 + -4^2 = 25 + 16 = 41

  // abcdefg
  // abcdefg - 0 1 2 3 4 5 6 = 1 + 1 + 1 + 1 + 1 + 1 = 6
  // aceg - 0 2 4 6 = 2 + 2 + 2 = 6
  // aceg - 0 2 4 6 = 2^2 + 2^2 + 2^2 = 4 + 4 + 4 = 12

  // tesy
  // e111s - 1 -1 -1 -1 2 = 1 + 3 = 4
  // er - 1 -1 = 1 + 3 = 4
  // ty - 0 3 = 3


  // branch
  // anch
  // me
  // sbn
  // som
  // sman
  // - flipped characters
  // smoe
  // branhc
  // ! should not match when flipped character are too far from each other
  // ! bs
  // - tolerate some amount of missing characters
  // someh
  // ! should not mach when there are too much of missing characters
  // ! something

}

function dim(s: string): string {
  if (s === '') {
    ''
  }

  return `\x1b[2m${s}\x1b[22m`
}

function highlight(s: string): string {
  return `\x1b[38;5;4m${s}\x1b[39m`
}

// Views

function viewBranchesList(state: State) {
  let branches = state.branches
  
  if (state.searchString !== '') {
    branches = branches.slice()
      .sort((a, b) => {
        return fuzzyMatch(state.searchString, b.name) - fuzzyMatch(state.searchString, a.name)
      })
      .map(branch => {
        return {
          ...branch,
          score: fuzzyMatch(state.searchString, branch.name)
        }
      })
      .filter(branch => ((branch as any).score > 0.3))
  }
  

  return branches.reduce((visibleBranches, branch, index) => {
    if (index < state.branchesScrollWindow[0] || index > state.branchesScrollWindow[1]) {
      return visibleBranches
    }

    const timeAgo = branch.lastSwitch !== 0 ? relativeDateTime(branch.lastSwitch) : ''
    let line = `${dim(index.toString())} ${branch.name}, ${(branch as any).score} ${dim(timeAgo)}`.trim()

    if (index === state.highlightedBranch) {
      line = highlight(line)
    }

    visibleBranches.push(line)

    return visibleBranches
  }, [])
}

function render(state: State) {  
  const SEARCH_PLACEHOLDER = 'Type to search'
  const search = state.searchString === '' ? dim(SEARCH_PLACEHOLDER) : state.searchString
  let result: string[] = [search]

  result = result.concat(viewBranchesList(state))

  if (state.branchesScrollWindow[1] < state.branches.length - 1) {
    result.push('Move down to see more branches')
  }

  // TODO: merge all writes into a single write
  // Move to the beginning of the line and clear everything after cursor
  process.stdout.write(`\x1b[1G`)
  process.stdout.write(`\x1b[0J`)

  // Render all the lines
  process.stdout.write(result.join('\n'))

  // Move cursor back to the first line
  // \x1b[0A will still move one line up, so
  // do not move in case there is only one line
  if (result.length > 1) {
    process.stdout.write(`\x1b[${result.length - 1}A`)
  }

  // Put cursor at the end of search string
  process.stdout.write(`\x1b[${state.searchStringCursorPosition + 1}G`)
  
  // console.log(process.stdout.rows)
  // process.stdout.write(`\x1b[1S`)
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

function calculateBranchesWindow() {
  const windowCenter = Math.floor((state.branchesScrollWindow[0] + state.branchesScrollWindow[1]) / 2)
  const windowTop = Math.max(
    0, 
    Math.min(
      state.branches.length - 1 - (WINDOW_SIZE - 1), 
      state.branchesScrollWindow[0] - (windowCenter - state.highlightedBranch)
    )
  )
  const windowBottom = windowTop + WINDOW_SIZE - 1

  state.branchesScrollWindow = [windowTop, windowBottom]
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

function bare() {
  const gitBranches = readdirSync('./.git/refs/heads')
  const branchesData = readBranchesData()

  state.branches = gitBranches
    .map(branch => {
      return {
        name: branch,
        lastSwitch: branchesData[branch] !== undefined ? branchesData[branch].lastSwitch : 0
      }
    })
    .sort((a, b) => b.lastSwitch - a.lastSwitch)

  // log(state.branches)

  render(state)

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
      state.highlightedBranch = Math.max(0, state.highlightedBranch - 1)
      calculateBranchesWindow()
      render(state)

      return
    }

    if (key.equals(DOWN)) {
      state.highlightedBranch = Math.min(state.branches.length - 1, state.highlightedBranch + 1)
      calculateBranchesWindow()
      render(state)

      return
    }

    if (key.equals(DELETE)) {
      if (state.searchString.length === 0) {
        return
      }

      state.searchString = state.searchString.slice(0, state.searchString.length - 1)  
      state.searchStringCursorPosition -= 1
      render(state)

      return
    }
  }

  function handleStringKey(key: Buffer) {
    const inputString = key.toString()

    state.searchString += inputString
    state.searchStringCursorPosition += inputString.length
    render(state)
  }

  process.stdin.on('data', (data: Buffer) => {
    log(data.toString('hex'))

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