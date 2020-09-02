/**
 * Finds indexes of all "search" character within "target".
 * When one index was found, next one will be looked after
 * the previous one.
 * E.g. search "abc", target "bcabc" result in [2, 3, 4]
 */
function findSequentialIndexes(search: string, target: string): number[] {
  const matchedIndexes: number[] = []

  for(let i = 0; i < search.length; i++) {
    const char = search[i]
    const previousMatchIndex = matchedIndexes.length === 0 ? -1 : matchedIndexes[matchedIndexes.length - 1]
    const matchedIndex = target.indexOf(char,  previousMatchIndex + 1)

    matchedIndexes.push(matchedIndex)
  }
  
  return matchedIndexes
}

export function fuzzyMatch(search: string, target: string): number {
  const matchedIndexes = findSequentialIndexes(search.toLowerCase(), target.toLowerCase())
    .filter(index => index !== -1)
  const matchScore = matchedIndexes.length / search.length

  if (matchScore < 1) {
    return 0
  }

  const maxPrefixIndex = Math.min(3, target.length - 1)

  let prefixBonus = 0
  let continuityBonus = 0

  for(let i = 0; i < matchedIndexes.length; i++) {
    const charDistance = i === 0 ? 0 : matchedIndexes[i] - matchedIndexes[i - 1]
    
    prefixBonus += Math.max(0, maxPrefixIndex - matchedIndexes[i])
    continuityBonus += charDistance === 1 ? 1 : 0
  }

  return matchScore + prefixBonus + continuityBonus
}