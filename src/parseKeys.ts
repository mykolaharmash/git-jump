import {StringDecoder} from 'string_decoder'

// Control Sequence Format
// 1b (5b|4f) [number] [; number]+ (Letter or ~)

export function parseKeys(data: Buffer) {
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