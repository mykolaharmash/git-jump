import * as os from 'os'
import { exec, spawnSync } from 'child_process'
import {existsSync, readdirSync, readFileSync, appendFileSync, opendirSync, Dirent, writeFileSync, mkdirSync} from 'fs'
import * as fsPath from 'path'
import { parseKeys } from './parseKeys'
import { fuzzyMatch } from './fuzzy'

class InputError extends Error {
  title: string

  constructor(title: string, message: string) {
    super(message)

    this.title = title
    this.message = message
  }
}


// Sub-commands

function isSubCommand(args: string[]): boolean {  
  const isDashDashSubCommand = [
    '--list', 
    '--version', 
    '-l',
    '-v',
    '-h'
  ].includes(args[0])

  const isMultiArgumentSubCommand = (
    args.length > 1 
    && ['new', 'delete', 'rename'].includes(args[0])
  )

  return isDashDashSubCommand || isMultiArgumentSubCommand
}

function executeSubCommand(name: string, args: string[]) {
  switch (name) {
    case '--list':
    case '-l': {
      listSubCommand()
      break
    }
    case '--version':
    case '-v': {
      versionSubCommand()
      break
    }
    // --help is handled by git natively, it open man page
    // using ./git-jump.1
    case '-h': {
      helpSubCommand()
      break
    }
    case 'new': {
      newSubCommand(args)
      break
    }
    case 'rename': {
      renameSubCommand(args)
      break
    }
    case 'delete': {
      deleteSubCommand(args)
      break
    }
    default: {
      throw new InputError(`Unknown command ${bold(`git jump ${name}`)}`, `See ${bold('git jump --help')} for the list of supported commands.`)
    }
  }
}

function versionSubCommand() {
  process.stdout.write(`${readVersion()}\n`)
  process.exit(0)
}

function listSubCommand(): void {
  state.isInteractive = false

  view(state)

  process.exit(0)
}

function newSubCommand(args: string[]): void {
  const { status, message } = gitSwitch(['--create', ...args])

  state.scene = Scene.Message
  state.message = message

  if (status === 0) {
    updateBranchLastSwitch(args[0], Date.now(), state)
  }

  view(state)

  process.exit(status)
}

function helpSubCommand(): void {
  let help = readFileSync(fsPath.join(__dirname, '../help.txt')).toString()

  help = help.replace(/\{bold\}(.+)\{\/bold\}/g, (substring, content) => bold(content))
  help = help.replace(/\{dim\}(.+)\{\/dim\}/g, (substring, content) => dim(content))
  help = help.replace(/\{wrap:(\d+)\}(.+)\{\/wrap\}/g, (substring, paddingSize, content) => {
    return multilineTextLayout(
      content.trim(), 
      process.stdout.columns - parseInt(paddingSize)
    ).map((line, index) => {
      // Padding only the lines which wrap to the next line,
      // first line supposed to be already padded
      return index === 0 ? line : ' '.repeat(paddingSize) + line
    }).join('\n')
  })

  process.stdout.write(help)

  process.exit(0)
}

function renameSubCommand(args: string[]): void {
  if (args.length < 2) {
    throw new InputError('Wrong Format.', `You should specify both current and new branch name, ${bold('git jump rename <old branch name> <new branch name>')}.`)
  }

  const { status, message } = gitCommand('branch', ['--move', args[0], args[1]])

  state.scene = Scene.Message
  state.message = message

  if (status === 0) {
    renameJumpDataBranch(args[0], args[1], state)

    state.message.push('Renamed.')
  }

  view(state)

  process.exit(status)
}

function deleteSubCommand(args: string[]): void {
  const { status, message } = gitCommand('branch', ['--delete', ...args])

  state.scene = Scene.Message
  state.message = message

  if (status === 0) {
    deleteJumpDataBranch(args, state)
  }

  view(state)

  process.exit(status)
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

enum ListItemType {
  Head,
  Branch
}

interface ListItem {
  type: ListItemType,
  content: CurrentHEAD | BranchData,
  searchMatchScore: number
}

interface PackageInfo {
  version: string
  engines: {
    node: string
  }
}

enum Scene {
  List,
  Message
}

interface State {
  rows: number
  columns: number
  highlightedLineIndex: number
  maxRows: number
  branches: BranchData[]
  searchString: string
  searchStringCursorPosition: number
  currentHEAD: CurrentHEAD
  list: ListItem[]
  lineSelected: boolean
  scene: Scene
  message: string[]
  gitRepoFolder: string | null
  isInteractive: boolean
  latestPackageVersion: string | null,
  packageInfo: PackageInfo | null
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
  scene: Scene.List,
  message: [],
  gitRepoFolder: null,
  isInteractive: true,
  latestPackageVersion: null,
  packageInfo: null
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[22m`
}

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[22m`
}

function highlight(s: string): string {
  return `\x1b[38;5;4m${s}\x1b[39m`
}

function green(s: string): string {
  return `\x1b[38;5;2m${s}\x1b[39m`
}

function yellow(s: string): string {
  return `\x1b[38;5;3m${s}\x1b[39m`
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

function highlightLine(line: string, lineIndex: number, highlightedLineIndex: number, selected: boolean = false) {
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

function truncate(s: string, maxWidth: number): string {
  let truncated = s.slice(0, maxWidth)

  if (truncated.length < s.length) {
    truncated = `${truncated.substring(0, truncated.length - 1)}…`
  }

  return truncated
}

function getQuickSelectLines(list: ListItem[]): ListItem[] {
  return list.filter((line: ListItem) => {
    return line.type !== ListItemType.Head
  }).slice(0, 10)
}

// Views

const branchIndexPadding = '   '

function viewCurrentHEAD(currentHEAD: CurrentHEAD, layout: LayoutColumn[]): string {
  return layout.reduce((line: string, column: LayoutColumn) => {
    if (column.type === LayoutColumnType.Index) {
      return line + branchIndexPadding
    }

    if (column.type === LayoutColumnType.BranchName) {      
      const branch = currentHEAD.detached 
        ? `${bold(currentHEAD.sha)} ${dim('(detached)')}`
        : bold(currentHEAD.branchName) 

      return line + branch
    }

    return line
  }, '') 
}

function viewBranch(
  branch: BranchData, 
  index: number, 
  layout: LayoutColumn[]
): string {
  return layout.reduce((line: string, column: LayoutColumn) => {
    if (column.type === LayoutColumnType.Index) {
      return line + (index < 10 ? ` ${dim(index.toString())} ` : branchIndexPadding)
    }

    if (column.type === LayoutColumnType.BranchName) {      
      return line + truncate(branch.name, column.width).padEnd(column.width, ' ')
    }

    return line
  }, '')  
}

function viewListLines(state: State, layout: LayoutColumn[]): string[] {
  let quickSelectIndex = -1

  return state.list.map((line: ListItem) => {
    switch (line.type) {
      case ListItemType.Head: {
        return viewCurrentHEAD(line.content as CurrentHEAD, layout)
      }

      case ListItemType.Branch: {
        quickSelectIndex++

        return viewBranch(
          line.content as BranchData, 
          quickSelectIndex, 
          layout
        )
      }
    }    
  })
}

function viewNonInteractiveList(state: State): string[] {
  const layout = [
    { type: LayoutColumnType.BranchName, width: state.columns },
  ]

  return viewListLines(state, layout)
}

function viewList(state: State): string[] {  
  if (state.list.length === 0) {
    return [`${branchIndexPadding}${dim('No such branches')}`]
  }
  
  const layout = calculateLayout(state)
  const listWindow = calculateLinesWindow(state.list.length, state.highlightedLineIndex)

  return viewListLines(state, layout)
    .map((line, index) => {
      return addScrollIndicator(
        highlightLine(line, index, state.highlightedLineIndex),
        index,
        state.list.length,
        listWindow,
        layout
      )
    })
    .slice(listWindow.topIndex, listWindow.bottomIndex + 1)
}

function viewQuickSelectHint(maxIndex: number, columnWidth: number): string {
  const trailingIndex = maxIndex > 0 ? `..${maxIndex}` : ''
  const modifierKey = os.type() === 'Darwin' ? '⌥' : 'Alt'

  return dim(`${modifierKey}+0${trailingIndex} quick select `.padStart(columnWidth, ' '))
}

function viewSearch(state: State, width: number): string {
  const SEARCH_PLACEHOLDER = 'Search'

  return state.searchString === '' ? dim(SEARCH_PLACEHOLDER.padEnd(width, ' ')) : truncate(state.searchString, width).padEnd(width, ' ')
}

function viewSearchLine(state: State): string {
  const searchPlaceholderWidth = 6
  const searchWidth = Math.min(
    state.columns - branchIndexPadding.length, 
    Math.max(state.searchString.length, searchPlaceholderWidth)
  )
  const hintMinWidth = 25

  let line = branchIndexPadding + viewSearch(state, searchWidth)
  const hintColumnWidth = state.columns - (branchIndexPadding.length + searchWidth)

  if (hintColumnWidth < hintMinWidth) {
    return line
  }
  
  const quickSelectLines = getQuickSelectLines(state.list)

  if (quickSelectLines.length === 0) {
    return line
  }

  line += viewQuickSelectHint(quickSelectLines.length - 1, hintColumnWidth)
  
  return line
}

function view(state: State) {
  switch (state.scene) {
    case Scene.List: {
      if (!state.isInteractive) {
        // concat(['']) will add trailing newline
        render(viewNonInteractiveList(state).concat(['']))
    
        return
      }

      let lines: string[] = []

      lines.push(viewSearchLine(state))
      lines = lines.concat(viewList(state))

      clear()
      render(lines)

      cursorTo(branchIndexPadding.length + state.searchStringCursorPosition + 1, 1)

      break
    }

    case Scene.Message: {
      clear()

      const lineSpacer = '  '
      const lines = [
        '',
        ...state.message.reduce((lines: string[], line: string) => {
          if (line === '') {
            lines.push('')

            return lines
          }

          return lines.concat(multilineTextLayout(line, process.stdout.columns - lineSpacer.length))
        }, []).map(line => lineSpacer + line),
        '',
        ''
      ]

      render(lines)

      break
    }
  }
}

/**
 * These properties cannot live in the main
 * app state as they are affected by rendering itself,
 * not by application logic. They are part of a different,
 * more low-level sub-system.
 */
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
const RIGHT = Buffer.from('1b5b43', 'hex')
const LEFT = Buffer.from('1b5b44', 'hex')
const DELETE = Buffer.from('7f', 'hex')
const BACKSPACE = Buffer.from('08', 'hex')
const ENTER = Buffer.from('0d', 'hex')

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

function isMetaPlusNumberCombination(key: Buffer) {
  if (key.length === 2 && key[0] === escapeCode) {
    return key[1] >= 0x30 && key[1] <=0x39
  }
}

function getNumberFromMetaPlusCombination(key: Buffer): number {
  // E.g. number = 5 = 0x35 = 0011 0101; 0011 0101 & 0000 1111 = 0000 0101 = 5
  return key[1] & 0x0F
}

function isSpecialKey(key: Buffer): boolean {
  return isEscapeCode(key) || isC0C1ControlCode(key) || isDeleteKey(key)
}

enum ListSortCriterion {
  LastSwitch,
  SearchMatchScore
}

function sortedListLines(list: ListItem[], criterion: ListSortCriterion): ListItem[] {
  if (criterion === ListSortCriterion.LastSwitch) {
    return list.slice().sort((a: ListItem, b: ListItem) => {
      if (b.type === ListItemType.Head) {
        return 1
      }

      return (b.content as BranchData).lastSwitch - (a.content as BranchData).lastSwitch
    })
  }

  return list.slice().sort((a: ListItem, b: ListItem) => {
    return b.searchMatchScore - a.searchMatchScore
  })
}

function generateList(state: State) {
  let list: ListItem[] = []

  list.push({ 
    type: ListItemType.Head, 
    content: state.currentHEAD, 
    searchMatchScore: state.searchString === '' ? 1 : fuzzyMatch(state.searchString, state.currentHEAD.detached ? state.currentHEAD.sha : state.currentHEAD.branchName)
  })

  const branchLines: ListItem[] = state.branches
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
        type: ListItemType.Branch, 
        content: branch,
        searchMatchScore: state.searchString === '' ? 1 : fuzzyMatch(state.searchString, branch.name)
      }
    })

  list = list.concat(branchLines)
    .filter((line: ListItem) => line.searchMatchScore > 0)

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
    throw new InputError(`You're not in Git repo.`, 'There is no Git repository in current or any parent folder.')
  }

  return locateGitRepoFolder(fsPath.resolve(folder, '..'))
}

function readPackageInfo() {
  if (state.packageInfo !== null) {
    return state.packageInfo
  }

  state.packageInfo = JSON.parse(readFileSync(fsPath.join(__dirname, '../package.json')).toString())

  return state.packageInfo
}

function readVersion() {  
  return readPackageInfo().version
}

function readRequiredNodeVersion() {
  const semverString = readPackageInfo().engines.node
  const match = semverString.match(/\d+\.\d+\.\d+/)

  return match === null ? null : match[0]
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

const JUMP_FOLDER = '.jump'
const DATA_FILE_PATH = `${JUMP_FOLDER}/data.json`

function readBranchesJumpData(gitRepoFolder: string): BranchDataCollection {  
  try {
    return JSON.parse(readFileSync(fsPath.join(gitRepoFolder, DATA_FILE_PATH)).toString())
  } catch (e) {
    throw new Error(`JSON in "${DATA_FILE_PATH}" is not valid, could not parse it.`)
  }  
}

function saveBranchesJumpData(gitRepoFolder: string, jumpData: BranchDataCollection): void {
  try {
    writeFileSync(fsPath.join(gitRepoFolder, DATA_FILE_PATH), JSON.stringify(jumpData, null, 2))
  } catch (e) {
    throw new Error(`Could not write data into "${DATA_FILE_PATH}".`)
  }  
}

/**
 * Cleans up branches that do not exists in Git already
 * but still present in jump data.
 */
function cleanUpJumpData(gitRepoFolder: string, jumpData: BranchDataCollection, rawGitBranches: string[]): void {
  const cleanJumpData = Object.keys(jumpData).reduce((cleanData, jumpDataBranchName) => {
    if (rawGitBranches.includes(jumpDataBranchName)) {
      cleanData[jumpDataBranchName] = jumpData[jumpDataBranchName]
    }

    return cleanData
  }, {} as BranchDataCollection)

  saveBranchesJumpData(gitRepoFolder, cleanJumpData)
}

function readBranchesData(gitRepoFolder: string): BranchData[] {
  const rawGitBranches = readRawGitBranches(gitRepoFolder)
  const branchesJumpData = readBranchesJumpData(gitRepoFolder)

  cleanUpJumpData(gitRepoFolder, branchesJumpData, rawGitBranches)

  return rawGitBranches
    .map(branch => {
      const jumpData = branchesJumpData[branch]

      return {
        name: branch,
        lastSwitch: jumpData !== undefined ? jumpData.lastSwitch : 0
      }
    })
}

function updateBranchLastSwitch(name: string, lastSwitch: number, state: State): void {
  const jumpData = readBranchesJumpData(state.gitRepoFolder)
  
  jumpData[name] = { name, lastSwitch }

  saveBranchesJumpData(state.gitRepoFolder, jumpData)
}

function renameJumpDataBranch(currentName: string, newName: string, state: State): void {
  const jumpData = readBranchesJumpData(state.gitRepoFolder)
  const currentJumpData = jumpData[currentName]

  if (currentJumpData === undefined) {
    return
  }
  
  jumpData[newName] = { ...currentJumpData, name: newName }
  delete jumpData[currentName]

  saveBranchesJumpData(state.gitRepoFolder, jumpData)
}

function deleteJumpDataBranch(branchNames: string[], state: State): void {
  const jumpData = readBranchesJumpData(state.gitRepoFolder)

  branchNames.forEach((name) => {
    if (jumpData[name] === undefined) {
      return
    }
    
    delete jumpData[name]
  })

  saveBranchesJumpData(state.gitRepoFolder, jumpData)
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

/**
 * Reads branch name from provided list line.
 * Returns null in case current HEAD was selected
 * and it's detached.
 */
function getBranchNameForLine(line: ListItem): string | null {
  switch (line.type) {
    case ListItemType.Head: {
      const content = line.content as CurrentHEAD

      return content.detached ? content.sha : content.branchName
    }

    case ListItemType.Branch: {
      return (line.content as BranchData).name
    }
  }
}

interface GitCommandResult {
  status: number 
  message: string[]
  stdout: string
  stderr: string  
}

function gitCommand(command: string, args: string[]): GitCommandResult {
  const commandString = ['git', command, ...args].join(' ')

  const { stdout, stderr, error, status } = spawnSync('git', [command, ...args], { encoding: 'utf-8' })

  if (error) {
    throw new Error(`Could not run ${bold(commandString)}.`)
  }

  const cleanLines = (text: string) => text.trim().split('\n').filter(line => line !== '')

  const statusIndicatorColor = status > 0 ? red : green
  const message = [
    statusIndicatorColor('‣ ') + dim(commandString),
    ...cleanLines(stdout),
    ...cleanLines(stderr)
  ]

  return { status, message, stdout, stderr }
}

function chainGitCommands(...commands: { (): GitCommandResult }[]): GitCommandResult[] {
  return commands.reduce((results: GitCommandResult[], command) => {
    const result = command()

    results.push(result)

    return results
  }, [])
}

function compoundGitCommandsResult(results: GitCommandResult[]): GitCommandResult {
  return results.reduce((compoundResult: GitCommandResult, result, i) => {
    compoundResult.status = result.status
    compoundResult.message = compoundResult.message.concat(result.message)

    // Add bland line between messages from different commands
    if (i !== results.length - 1) {
      compoundResult.message.push('')
    }

    compoundResult.stderr += result.stderr
    compoundResult.stdout += result.stdout

    return compoundResult
  }, { status: 0, message: [], stderr: '', stdout: '' })
}

function gitSwitch(args: string[]): GitCommandResult {
  const isParameter = (argument: string) => argument.startsWith('-') || argument.startsWith('--')
  const switchResult = gitCommand('switch', args)  
  const branchName = args.length === 1 && !isParameter(args[0]) ? args[0] : null
    
  if (switchResult.status === 0 && branchName !== null) {
    updateBranchLastSwitch(branchName, Date.now(), state)
  }
  
  return switchResult
}

function switchToListItem(item: ListItem): void {
  const branchName = getBranchNameForLine(item)      

  if (item.type === ListItemType.Head) {
    state.scene = Scene.Message  
    state.message = [`Staying on ${bold(branchName)}`]
    view(state)

    process.exit(0)
  }

  const { status, message } = gitSwitch([branchName])

  state.scene = Scene.Message
  state.message = message

  view(state)

  process.exit(status)
}

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
  // 7f, 08 - Delete, 08 on Windows
  // 0d - Enter
  // 1b5b337e - fn+Delete, Forward Delete
  // 1b7f - Option+Delete, delete whole word
  // 17 - Control+w, delete the whole line
  // 0b - Control+k, delete from cursor to the end of the line
  // 1b30 .. 1b39 - Alt+0..9

  if (key.equals(CTRL_C)) {
    clear()
    process.exit()
  }

  if (key.equals(ENTER)) {
    switchToListItem(state.list[state.highlightedLineIndex])

    return
  }

  if (key.equals(UP)) {
    state.highlightedLineIndex = Math.max(0, state.highlightedLineIndex - 1)
    view(state)

    return
  }

  if (key.equals(RIGHT)) {
    if (state.searchStringCursorPosition === state.searchString.length) {
      return
    }
    
    state.searchStringCursorPosition += 1
    view(state)

    return
  }

  if (key.equals(LEFT)) {
    if (state.searchStringCursorPosition === 0) {
      return
    }
    
    state.searchStringCursorPosition -= 1
    view(state)

    return
  }

  if (key.equals(DOWN)) {
    state.highlightedLineIndex = Math.min(state.list.length - 1, state.highlightedLineIndex + 1)
    view(state)

    return
  }

  if (key.equals(DELETE) || key.equals(BACKSPACE)) {
    if (state.searchStringCursorPosition === 0) {
      return
    }

    state.searchString = state.searchString.substring(0, state.searchStringCursorPosition - 1) + state.searchString.substring(state.searchStringCursorPosition, state.searchString.length)
    state.searchStringCursorPosition -= 1
    state.list = generateList(state)
    state.highlightedLineIndex = 0
    view(state)

    return
  }

  if (isMetaPlusNumberCombination(key)) {
    const quickSelectIndex = getNumberFromMetaPlusCombination(key)
    const quickSelectLines = getQuickSelectLines(state.list)

    if (quickSelectIndex < quickSelectLines.length) {
      switchToListItem(quickSelectLines[quickSelectIndex])
    }

    return
  }
}

function handleStringKey(key: Buffer) {
  const inputString = key.toString()

  state.searchString = state.searchString.substring(0, state.searchStringCursorPosition) + inputString + state.searchString.substring(state.searchStringCursorPosition, state.searchString.length)
  state.searchStringCursorPosition += inputString.length
  state.list = generateList(state)
  state.highlightedLineIndex = 0

  view(state)
}

function bare() {  
  view(state)

  if (!state.isInteractive) {
    process.exit(0)
  }

  process.stdin.setRawMode(true)

  process.stdin.on('data', (data: Buffer) => {
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
  const switchResult = gitSwitch(args)

  if (switchResult.status === 0) {
    state.scene = Scene.Message
    state.message = switchResult.message

    view(state)

    process.exit(0)
  }

  // Generate filtered and sorted list of branches
  state.searchString = args[0]
  state.list = generateList(state)

  if (state.list.length === 0) {
    state.scene = Scene.Message
    state.message = [`${bold(yellow(state.searchString))} does not match any branch`]

    view(state)

    process.exit(1)
  }

  switchToListItem(state.list[0])
}

function multilineTextLayout(text: string, columns: number): string[] {
  if (text.length === 0) {
    return []
  }

  const words = text.split(' ')  
  const escapeCodePattern = /\x1b.+?m/gi

  return words.slice(1).reduce((lines, word) => {
    const currentLine = lines[lines.length - 1]
    const sanitizedCurrentLine = currentLine.replace(escapeCodePattern, '')
    const sanitizedWord = word.replace(escapeCodePattern, '')

    // +1 at the end is for the space in front of the word
    if (sanitizedCurrentLine.length + sanitizedWord.length + 1 <= columns) {
      lines[lines.length - 1] = currentLine + ' ' + word
    } else {
      lines.push(word)
    }

    return lines
  }, [words[0]])
}

function checkUpdates(): void {
  const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

  exec('npm info git-jump dist-tags.latest', (error, stdout) => {
    if (error) {
      return
    }

    const output = stdout.trim()

    if (!VERSION_PATTERN.test(output)) {
      return
    }

    state.latestPackageVersion = output
  })
}

function compareSemver(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

function handleError(error: Error): void {
  if (error instanceof InputError) {
    state.message = [`${yellow(error.title)} ${error.message}`]  
  } else {
    state.message = [
      `${red('Error:')} ${error.message}`,
      '',
      `${bold('What to do?')}`,
      'Help improve git-jump, create GitHub issue with this error and steps to reproduce it. Thank you!',
      '',
      `GitHub Issues: https://github.com/mykolaharmash/git-jump/issues`
    ]
  }

  state.scene = Scene.Message
  view(state)
  process.exit(1)
}

function handleExit() {  
  if (state.latestPackageVersion === null) {
    return
  }

  const currentVersion = readVersion()

  if (compareSemver(currentVersion, state.latestPackageVersion) === -1) {
    const sourcePackageManager = existsSync(fsPath.join(__dirname, '../homebrew')) ? 'homebrew' : 'npm'
    const updateCommand = sourcePackageManager === 'npm' ? 'npm install -g git-jump' : 'brew upgrade git-jump'

    state.scene = Scene.Message
    state.message = state.message.concat([
      '',
      `New version of git-jump is available: ${yellow(currentVersion)} → ${green(state.latestPackageVersion)}.`,
      `Changelog: https://github.com/mykolaharmash/git-jump/releases/tag/v${state.latestPackageVersion}`,
      '',
      `${bold(updateCommand)} to update.`
    ])

    view(state)
  }
}

function initialize() {
  state.isInteractive = process.stdout.isTTY === true
  state.gitRepoFolder = locateGitRepoFolder(process.cwd())  

  const jumpFolderPath = fsPath.join(state.gitRepoFolder, JUMP_FOLDER)
  const dataFileFullPath = fsPath.join(state.gitRepoFolder, DATA_FILE_PATH)

  if (!existsSync(jumpFolderPath)) {
    mkdirSync(jumpFolderPath)
    // Exclude .jump from Git tracking
    appendFileSync(
      fsPath.join(state.gitRepoFolder, '.git', 'info', 'exclude'), 
      `\n${JUMP_FOLDER}`
    )
  }

  if (!existsSync(dataFileFullPath)) {
    writeFileSync(dataFileFullPath, '{}', { flag: 'a' })
  }

  state.currentHEAD = readCurrentHEAD(state.gitRepoFolder)
  state.branches = readBranchesData(state.gitRepoFolder)
  state.list = generateList(state)
  state.highlightedLineIndex = 0
}

function ensureNodeVersion() {
  const currentVersion = process.versions.node
  const requiredVersion = readRequiredNodeVersion()

  if (requiredVersion === null) {
    return
  }

  if (compareSemver(currentVersion, requiredVersion) === -1) {
    throw new InputError('Unsupported Node.js version.', `git-jump requires Node.js version >=${requiredVersion}, you're using ${currentVersion}.`)
  }
}

function main(args: string[]) {
  process.on('uncaughtException', handleError)
  process.on('exit', handleExit)

  ensureNodeVersion()
  initialize()

  if (args.length === 0) {
    // Checking for updates only when interactive UI is started
    // as only then there potentially a chance for update
    // request to finish before git-jump exists 
    checkUpdates()
    bare()

    return
  }

  if (isSubCommand(args)) {
    executeSubCommand(args[0], args.slice(1))

    return
  }

  jumpTo(args)  
}

main(process.argv.slice(2))