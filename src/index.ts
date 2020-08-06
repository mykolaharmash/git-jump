import { execSync } from 'child_process'
import {readdirSync, fstat, writeFile} from 'fs'


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

interface State {
  highlightedBranch: number
  branchesScrollWindow: [number, number]
  maxRows: number
  branches: string[]
}

const WINDOW_SIZE = process.stdout.rows - 3
const state: State = {
  highlightedBranch: 0,
  branchesScrollWindow: [0, WINDOW_SIZE - 1],
  maxRows: process.stdout.rows,
  branches: [
    'branch-0',
    'branch-1',
    'branch-2',
    'branch-3',
    'branch-4',
    'branch-5',
    'branch-6',
    'branch-7',
    'branch-8',
    'branch-9',
    'branch-10',
    'branch-11',
    'branch-12',

    'branch-13',
    'branch-14',
    'branch-15',
    'branch-16',
    'branch-17',
    'branch-18',
    'branch-19',
    'branch-20',
    'branch-21',
    'branch-22',
  ]
}

function render(state: State) {  
  let result: string[] = [
    'Branches:'
  ]

  result = result.concat(state.branches.reduce((visibleBranches, branch, index) => {
    if (index < state.branchesScrollWindow[0] || index > state.branchesScrollWindow[1]) {
      return visibleBranches
    }

    if (index === state.highlightedBranch) {
      visibleBranches.push(`\x1b[38;5;2m${index} ${branch}\x1b[38;m`)
    } else {
      visibleBranches.push(`${index} ${branch}`)
    }

    return visibleBranches
  }, []))

  if (state.branchesScrollWindow[1] < state.branches.length - 1) {
    result.push('Move down to see more branches')
  }

  // Move to the beginning of the line and clear everything after cursor
  process.stdout.write(`\x1b[1G`)
  process.stdout.write(`\x1b[0J`)

  process.stdout.write(result.join('\n'))
  process.stdout.write(`\x1b[${result.length - 1}A`)
  process.stdout.write(`\x1b[${result[0].length + 1}G`)
  // console.log(process.stdout.rows)
  // process.stdout.write(`\x1b[1S`)
}

const CTRL_C = Buffer.from('03', 'hex')
const UP = Buffer.from('1b5b41', 'hex')
const DOWN = Buffer.from('1b5b42', 'hex')
const LETTER_g = Buffer.from('g', 'utf8')

function bare() {
  // console.log('Bare')

  // state.branches = readdirSync('./.git/refs/heads')

  render(state)


  process.stdin.setRawMode(true)
  process.stdin.on('data', (key: Buffer) => {
    // console.log('data', key)

    if (key.equals(CTRL_C)) {
      process.stdout.write('\n')
      process.exit()
    }

    if (key.equals(UP)) {
      state.highlightedBranch = Math.max(0, state.highlightedBranch - 1)
    }

    if (key.equals(DOWN)) {
      state.highlightedBranch = Math.min(state.branches.length - 1, state.highlightedBranch + 1)
    }

    const windowCenter = Math.floor((state.branchesScrollWindow[0] + state.branchesScrollWindow[1]) / 2)
    const windowTop = Math.max(0, Math.min(state.branches.length - 1 - (WINDOW_SIZE - 1), state.branchesScrollWindow[0] - (windowCenter - state.highlightedBranch)))
    const windowBottom = Math.min(state.branches.length - 1, windowTop + WINDOW_SIZE - 1, state.branchesScrollWindow[1] + windowCenter + state.highlightedBranch)

    // writeFile('./log', Buffer.from(`windowCenter: ${windowCenter}; oldTop: ${state.branchesScrollWindow[0]}; oldBottom: ${state.branchesScrollWindow[1]}; cursor: ${state.highlightedBranch}; top: ${windowTop}; bottom: ${windowBottom}\n`), () => {})

    state.branchesScrollWindow = [windowTop, windowBottom]

    render(state)
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