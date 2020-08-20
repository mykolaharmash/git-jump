import {Writable} from 'stream'
import { execSync } from 'child_process'
import {StringDecoder} from 'string_decoder'
import * as readline from 'readline'
import {readdirSync, fstat, writeFile, readFileSync, appendFileSync} from 'fs'


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

function dim(s: string): string {
  if (s === '') {
    ''
  }

  return `\x1b[2m${s}\x1b[22m`
}

function highlight(s: string): string {
  return `\x1b[38;5;4m${s}\x1b[39m`
}

function render(state: State) {  
  const SEARCH_PLACEHOLDER = 'Type to search'
  const search = state.searchString === '' ? dim(SEARCH_PLACEHOLDER) : state.searchString
  let result: string[] = [search]

  result = result.concat(state.branches.reduce((visibleBranches, branch, index) => {
    if (index < state.branchesScrollWindow[0] || index > state.branchesScrollWindow[1]) {
      return visibleBranches
    }

    const timeAgo = branch.lastSwitch !== 0 ? relativeDateTime(branch.lastSwitch) : ''
    let line = `${dim(index.toString())} ${branch.name} ${dim(timeAgo)}`.trim()

    if (index === state.highlightedBranch) {
      line = highlight(line)
    }

    visibleBranches.push(line)

    return visibleBranches
  }, []))

  if (state.branchesScrollWindow[1] < state.branches.length - 1) {
    result.push('Move down to see more branches')
  }

  // TODO: merge all writes into a single write
  // Move to the beginning of the line and clear everything after cursor
  process.stdout.write(`\x1b[1G`)
  process.stdout.write(`\x1b[0J`)

  process.stdout.write(result.join('\n'))
  process.stdout.write(`\x1b[${result.length - 1}A`)
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

  // writeFile('./log', Buffer.from(`windowCenter: ${windowCenter}; oldTop: ${state.branchesScrollWindow[0]}; oldBottom: ${state.branchesScrollWindow[1]}; cursor: ${state.highlightedBranch}; top: ${windowTop}; bottom: ${windowBottom}\n`), () => {})

  state.branchesScrollWindow = [windowTop, windowBottom]
}

const UNICODE_C0_RANGE: [Buffer, Buffer] = [Buffer.from('00', 'hex'), Buffer.from('1F', 'hex')]
const UNICODE_C1_RANGE: [Buffer, Buffer] = [Buffer.from('80', 'hex'), Buffer.from('9F', 'hex')]

function isControlCharacter(key: Buffer) {
  // If key buffer has more then one byte it's not a control character
  if (key.length > 1) {
    return false
  }

  const inC0Range = key.compare(UNICODE_C0_RANGE[0]) >= 0 && key.compare(UNICODE_C0_RANGE[1]) <= 0
  const inC1Range = key.compare(UNICODE_C1_RANGE[0]) >= 0 && key.compare(UNICODE_C1_RANGE[1]) <= 0

  return inC0Range || inC1Range
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

  // readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  // process.stdin.setEncoding('utf-8')

  // process.stdin.on('keypress', (key) => {
  //   console.log(Buffer.from(key, 'utf8'))

  //   console.log(`Received: ${key}`);
  // });

  // process.stdin.setDefaultEncoding('utf16le')
  // process.stdout.write(Buffer.from('d0', 'hex'))

  // Control Sequence Format
  // 1b (5b|4f) [number] [; number]+ (Letter or ~)

  // Supported escape codes
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

  function parseKeys(data: Buffer) {
    const keys = []    
    let context = null

    const createEscapeSequenceContext = () => {
      let state: string | null = null
      let buffer: number[] = []
      let key: Buffer | null = null

      const setKey = () => {
        key = Buffer.from(buffer)
        buffer = []
      }

      return { 
        end: () => {
          return buffer.length === 0 ? null : Buffer.from(buffer)
        },
        
        push: (char: number) => {
          buffer.push(char)

          switch (state) {
            case null: {
              state = 'escape-symbol'

              break
            }

            case 'escape-symbol': {
              if (char === 0x5b || char == 0x4f || char === 0x4e) {
                // It's one of the valid escape symbols, so 
                // can proceed to parsing parameters
                state = 'parameters'
              } else {
                // parsing a key like "1b7f"
                setKey()
              }

              break
            }

            case 'parameters': {
              // If it's any letter or ~, close the context
              if (
                (char >= 0x41 && char <= 0x5a) 
                || (char >= 0x61 && char <= 0x7a) 
                || char === 0x7e
              ) {
                setKey()
              }

              break
            }

            default: {
              throw new Error('Unknown state')
            }
          } 
        },

        getKey: () => key
      } 
    }
  

    const createStringContext = () => {
      const decoder = new StringDecoder('utf-8')
      let key: Buffer | null = null

      return { 
        end: () => {
          const rest = decoder.end()

          return rest === '' ? null : rest
        },

        push: (char: number) => { 
          const result = decoder.write(Buffer.from([char]))

          if (result !== '') {
            key = Buffer.from(result, 'utf-8')
          }
        },

        getKey: () => key
      }
    }

    for (let char of data) {
      if (context === null) {
        if (char === 0x1b) {
          context = createEscapeSequenceContext()
        } else {
          context = createStringContext()
        }
      }
      
      context.push(char)
      const key = context.getKey()

      // If context could parse a key, save the key 
      // and reset the context so that next character 
      // is treated out of context and new context 
      // can be created
      if (key !== null) {
        keys.push(key)
        context = null
      }
      
    }

    // We processed all characters but there might be a case
    // that context could parse only some of them into actual
    // key
    const unparsedChars = context === null ? null : context.end()

    if (unparsedChars !== null) {
      keys.push(unparsedChars)
    }

    return keys
  }

  process.stdin.on('data', (data: Buffer) => {
    log(data.toString('hex'))

    parseKeys(data).forEach((key: Buffer) => {
      // const key = Buffer.from(k.sequence, 'utf8')

      // log(key.toString('hex'))

      // render(state)
      
      // return

      // for (let i = 0; i <= 1000000000; i++) {}
      
      

      if (key.equals(CTRL_C)) {
        process.stdout.write('\n')
        process.exit()
      }
      
      if (isControlCharacter(key)) {
        log('control character')

        return
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

      // state.searchString += `\u200C`
      // log(state.searchString.length)
      state.searchString += key.toString()
      // log('modifying search string')
      // log(key.toString().length)  
      state.searchStringCursorPosition += 1
      // log(`search length: ${state.searchString.length}, cursor: ${state.searchStringCursorPosition}`)
      render(state)
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