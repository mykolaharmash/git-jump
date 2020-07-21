import { execSync } from 'child_process'

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

function bare() {
  console.log('Bare')
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