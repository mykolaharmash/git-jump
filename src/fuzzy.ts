/**
 * Finds indexes of all "search" character within "target".
 * For each character in "search" there will be only one 
 * corresponding index from "target" even when "search" has
 * repeating characters.
 * E.g. search - "aaa", target - "aba" will result in [0, 2, -1]
 */
function findUniqIndexes(search: string, target: string): number[] {
  const matchedIndexMap: Map<string, number> = new Map()
  const matchedIndexes: number[] = []

  for(let i = 0; i < search.length; i++) {
    const char = search[i]
    const previousMatchIndex = matchedIndexMap.has(char) ? matchedIndexMap.get(char) : -1

    const matchedIndex = target.indexOf(char, previousMatchIndex + 1)

    matchedIndexMap.set(char, matchedIndex)
    matchedIndexes.push(matchedIndex)
  }
  
  return matchedIndexes
}

export function fuzzyMatch(search: string, target: string): number {
  const matchedIndexes = findUniqIndexes(search, target).filter(index => index !== -1)

  const maxPrefixIndex = 3
  const maxTotalPrefixBonus = 2

  const minScore = 1
  // As continuity multiplier always increases by one,
  // maximum score (excluding prefix bonus) in best case scenario will be equal to
  // sum of all char indexes (shifted by 1) in search string,
  // which can be calculated with a formula: 1+ 2+ ... + n = n(n+1) / 2
  const maxScore = (search.length * (search.length + 1) / 2) + maxTotalPrefixBonus + minScore
  let score = minScore
  let continuityMultiplier = 1

  for(let i = 0; i < matchedIndexes.length; i++) {
    const charDistance = i === 0 ? 0 : matchedIndexes[i] - matchedIndexes[i - 1]
    const orderMultiplier = charDistance < 0 ? 0 : 1
    const prefixBonus = Math.max(0, (maxPrefixIndex - matchedIndexes[i]) / maxPrefixIndex)

    continuityMultiplier = charDistance === 1 ? continuityMultiplier + 1 : 1

    score += (continuityMultiplier + prefixBonus) * orderMultiplier
  }

  return score / maxScore
}