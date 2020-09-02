import {Writable} from 'stream'
import { exec, execSync, spawnSync } from 'child_process'
import {readdirSync, fstat, writeFile, readFileSync, appendFileSync, opendirSync, Dirent} from 'fs'
import * as fsPath from 'path'
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

enum Scene {
  List,
  SelectionLogs
}

interface State {
  rows: number
  columns: number
  highlightedLineIndex: number
  maxRows: number
  branches: BranchData[]
  searchString: string
  searchStringCursorPosition: number
  currentHEAD: CurrentHEAD,
  list: ListLine[],
  lineSelected: boolean,
  scene: Scene
}

const state: State = {
  rows: process.stdout.rows,
  columns: process.stdout.columns,
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
  list: [],
  lineSelected: false,
  scene: Scene.List
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

function framed(s: string): string {
  return `\x1b[51m${s}\x1b[22m`
}

function highlight(s: string): string {
  return `\x1b[38;5;4m${s}\x1b[39m`
}

function green(s: string): string {
  return `\x1b[38;5;2m${s}\x1b[39m`
}

function red(s: string): string {
  return `\x1b[38;5;1m${s}\x1b[39m`
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

enum LayoutColumnType {
  Index,
  BranchName,
  LastUsed,
  MoreIndicator
}

interface LayoutColumn {
  type: LayoutColumnType
  width: number
}

function calculateLayout(state: State): LayoutColumn[] {
  const indexColumnWidth = 3
  const moreIndicatorColumnWidth = 5
  const branchNameColumnWidth = Math.min(
    state.columns - indexColumnWidth - moreIndicatorColumnWidth,
    Math.max.apply(null, state.branches.map((branch: BranchData) => {
      return branch.name.length
    }))
  )
  const moreIndicatorSpacingWidth = state.columns - indexColumnWidth - branchNameColumnWidth - moreIndicatorColumnWidth

  return [
    { type: LayoutColumnType.Index, width: indexColumnWidth },
    { type: LayoutColumnType.BranchName, width: branchNameColumnWidth },
    { type: LayoutColumnType.MoreIndicator, width: moreIndicatorSpacingWidth + moreIndicatorColumnWidth }
  ]
}

function highlightLine(line: string, lineIndex: number, highlightedLineIndex: number, selected: true) {
  if (lineIndex === highlightedLineIndex) {
    return selected ? green(line) : highlight(line)
  }

  return line
}

function addScrollIndicator(line: string, lineIndex: number, listLength: number, listWindow: LinesWindow, layout: LayoutColumn[]): string {
  if (lineIndex === listWindow.bottomIndex && listWindow.bottomIndex < listLength - 1) {
    return line + dim('   ↓ '.padStart(layout[layout.length - 1].width, ' '))
  }

  return line
}

// Views

const branchIndexPadding = '   '

function viewCurrentHEAD(currentHEAD: CurrentHEAD): string {
  if (!currentHEAD.detached) {
    return `${branchIndexPadding}${bold(currentHEAD.branchName)}`
  }

  return `${branchIndexPadding}${bold(currentHEAD.sha)} ${dim('(detached)')}`
}

function viewBranch(
  branch: BranchData, 
  index: number, 
  layout: LayoutColumn[]
): string {
  return layout.reduce((line: string, column: LayoutColumn) => {
    if (column.type === LayoutColumnType.Index) {
      return line + (index < 10 ? ` ${dim(index.toString())} ` : '   ')
    }

    if (column.type === LayoutColumnType.BranchName) {
      let truncatedName = branch.name.slice(0, column.width)

      if (truncatedName.length < branch.name.length) {
        truncatedName = `${truncatedName.substring(0, truncatedName.length - 1)}…`
      }
      
      return line + truncatedName.padEnd(column.width, ' ')
    }

    return line
  }, '')  
}

function viewList(state: State): string[] {  
  if (state.list.length === 0) {
    return [`${branchIndexPadding}${dim('No such branches')}`]
  }
  
  const layout = calculateLayout(state)
  const listWindow = calculateLinesWindow(state.list.length, state.highlightedLineIndex)

  return state.list.map((line: ListLine, index: number) => {
    switch (line.type) {
      case ListLineType.Head: {
        return viewCurrentHEAD(line.content as CurrentHEAD)
      }

      case ListLineType.Branch: {
        return viewBranch(
          line.content as BranchData, 
          index - (state.list[0].type === ListLineType.Head ? 1 : 0), 
          layout
        )
      }
    }
    
  })
    .map((line, index) => {
      return addScrollIndicator(
        highlightLine(line, index, state.highlightedLineIndex, state.lineSelected),
        index,
        state.list.length,
        listWindow,
        layout
      )
    })
    .slice(listWindow.topIndex, listWindow.bottomIndex + 1)
}

function viewSearch(state: State): string {
  const SEARCH_PLACEHOLDER = 'Search'
  const search = state.searchString === '' ? dim(SEARCH_PLACEHOLDER) : state.searchString

  return `${branchIndexPadding}${search}`
}

function view(state: State) {
  switch (state.scene) {
    case Scene.List: {
      let lines: string[] = []

      lines.push(viewSearch(state))
      lines = lines.concat(viewList(state))

      clear()
      render(lines)
      cursorTo(branchIndexPadding.length + state.searchStringCursorPosition + 1, 1)

      break
    }

    case Scene.SelectionLogs: {
      clear()
      render(['Helloooo!'])
    }
  }
}

interface RenderState {
  cursorY: number
}

const renderState: RenderState = {
  cursorY: 1
}

function clear() {
  cursorTo(1, 1)

  // Clear everything after the cursor
  process.stdout.write(`\x1b[0J`)
}

function render(lines: string[]) {  
  process.stdout.write(lines.join('\n'))

  // Keep track of the cursor's vertical position
  // in order to know how many lines to move up 
  // to clean the screen later
  renderState.cursorY = lines.length
}

function cursorTo(x: number, y: number) {
  const yDelta = renderState.cursorY - y

  // Move cursor back to the first line
  // \x1b[0A will still move one line up, so
  // do not move in case there is only one line
  if (yDelta > 0) {
    process.stdout.write(`\x1b[${yDelta}A`)
  }
  
  // There is an escape sequence for moving
  // cursor horizontally using absolute coordinate,
  // so no need to use delta here, like for Y
  process.stdout.write(`\x1b[${x}G`)

  renderState.cursorY = y
}

const CTRL_C = Buffer.from('03', 'hex')
const UP = Buffer.from('1b5b41', 'hex')
const DOWN = Buffer.from('1b5b42', 'hex')
const DELETE = Buffer.from('7f', 'hex')
const ENTER = Buffer.from('0d', 'hex')
const SPACE = Buffer.from('20', 'hex')

function log(s: any) {
  appendFileSync('./log', Buffer.from(`${JSON.stringify(s)}\n`))
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

  list = list.concat(branchLines)
    .filter((line: ListLine) => line.searchMatchScore > 0)

  const sortCriterion = state.searchString === '' ? ListSortCriterion.LastSwitch : ListSortCriterion.SearchMatchScore

  return sortedListLines(list, sortCriterion)
}

function locateGitRepoFolder(folder: string): string {
  const dir = opendirSync(folder)

  let item = dir.readSync()
  let found = false

  while(item !== null && !found) {
    found = item.isDirectory() && item.name === '.git'
    item = dir.readSync()
  }

  dir.closeSync()

  if (found) {
    return folder
  }

  if (folder === '/') {
    throw new Error('There is no Git repository in current or any parent folder.')
  }

  return locateGitRepoFolder(fsPath.resolve(folder, '..'))
}

function readRawGitBranches(gitRepoFolder: string): string[] {
  function collectBranchNames(folderPath: string, prefix: string = ''): string[] {
    return readdirSync(folderPath, { withFileTypes: true })
      .reduce((branches: string[], item: Dirent) => {
        if (item.isFile()) {
          branches.push(prefix + item.name)
        }    

        if (item.isDirectory()) {
          branches = branches.concat(
            collectBranchNames(fsPath.join(folderPath, item.name), `${prefix}${item.name}/`)
          )
        }

        return branches
      }, [])
  }

  return collectBranchNames(fsPath.join(gitRepoFolder, '.git/refs/heads'))
}

type BranchDataCollection =  {[key: string]: BranchData}

function readBranchesJumpData(gitRepoFolder: string): BranchDataCollection {
  const dataFilePath = '.jump/data.json'
  
  try {
    return JSON.parse(readFileSync(fsPath.join(gitRepoFolder, dataFilePath)).toString())
  } catch (e) {
    throw new Error(`JSON in "${dataFilePath}" is not valid, could not parse it.`)
  }  
}

function readBranchesData(gitRepoFolder: string): BranchData[] {
  const rawGitBranches = readRawGitBranches(gitRepoFolder)
  const branchesJumpData = readBranchesJumpData(gitRepoFolder)

  return rawGitBranches
    .map(branch => {
      const jumpData = branchesJumpData[branch]

      return {
        name: branch,
        lastSwitch: jumpData !== undefined ? jumpData.lastSwitch : 0
      }
    })
}


function readCurrentHEAD(gitRepoFolder: string): CurrentHEAD {
  const head = readFileSync(fsPath.join(gitRepoFolder, '.git/HEAD')).toString()
  const detached = !head.startsWith('ref:')

  return {
    detached,
    sha: detached ? head.slice(0, 7).trim() : null,
    branchName: detached ? null : head.slice(16).trim()
  }
}

function handleSelection(state: State) {
  const selectedLine = state.list[state.highlightedLineIndex]

  switch (selectedLine.type) {
    case ListLineType.Head: {
      log('selected head, do nothing')

      break
    }

    case ListLineType.Branch: {
      const branchData = selectedLine.content as BranchData
      const args = ['switch', branchData.name]
      const commandString = ['git', ...args].join(' ')

      const { stdout, stderr, error, status } = spawnSync('git', args)

      if (error) {
        throw new Error(`Could not run ${bold(commandString)}.`)
      }

      if (stderr.length > 0) {
        clear()

        const spacer = '   '
        const lines = [
          '',
          red('‣ ') + dim(commandString),
          ...stderr.toString().split('\n')
            .reduce((lines: string[], line: string) => {
              return lines.concat(multilineTextLayout(line, process.stdout.columns - spacer.length))
            }, []),
          ''
        ]
          
        lines.forEach(line => {
          process.stdout.write(spacer + line + '\n')
        })



        process.exit(status)
      }

      // exec(switchCommand, (error, stdout, stderr) => {
      //   if (error) {
      //     log(error.message)
      //   }

      //   log('\n\n')
      //   log(stdout)

      //   log('\n\n')
      //   log(stderr)

      // })

      // log(output)

      break
    }
  }
}

function bare() {
  const gitRepoFolder = locateGitRepoFolder(process.cwd())

  state.currentHEAD = readCurrentHEAD(gitRepoFolder)
  state.branches = readBranchesData(gitRepoFolder)
  
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
    // 0d - Enter
    // 1b5b337e - fn+Delete, Forward Delete
    // 1b7f - Option+Delete, delete whole word
    // 17 - Control+w, delete the whole line
    // 0b - Control+k, delete from cursor to the end of the line

    if (key.equals(CTRL_C)) {
      clear()
      process.stdout.write('\n')
      process.exit()
    }

    if (key.equals(ENTER)) {
      state.lineSelected = true
      view(state)

      state.scene = Scene.SelectionLogs
      handleSelection(state)
      view(state)

      return
    }

    if (key.equals(UP)) {
      state.highlightedLineIndex = Math.max(0, state.highlightedLineIndex - 1)
      view(state)

      return
    }

    if (key.equals(DOWN)) {
      state.highlightedLineIndex = Math.min(state.list.length - 1, state.highlightedLineIndex + 1)
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

function multilineTextLayout(text: string, columns: number): string[] {
  if (text.length === 0) {
    return []
  }

  const words = text.split(' ')  

  return words.slice(1).reduce((lines, word) => {
    const currentLine = lines[lines.length - 1]

    // + 1 at the end is wor space in front of the word
    if (currentLine.length + word.length + 1 <= columns) {
      lines[lines.length - 1] = currentLine + ' ' + word
    } else {
      lines.push(word)
    }

    return lines
  }, [words[0]])
}

function handleError(error: Error): void {
  const spacing = '  '

  clear()
  render([
    '',
    `${spacing}${red('Error:')} ${error.message}`,
    '',
    `${spacing}${bold('What to do?')}`,
    ...multilineTextLayout(
      'Help improve git-jump, create GitHub issue with this error and steps to reproduce it. Thank you!', 
      process.stdout.columns - spacing.length
    ).map(line => `${spacing}${line}`),
    '',
    `${spacing}GitHub Issues: https://github.com/mykolaharmash/git-jump/issues`,
    '',
    ''
  ])

  // console.log(error)

  process.exit(1)
}

function main(args: string[]) {

  process.on('uncaughtException', handleError)

  // process.on('exit', (code) => {
    // If there are updates available, suggest user to update
  // })

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