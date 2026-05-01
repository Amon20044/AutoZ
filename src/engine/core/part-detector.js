/**
 * @module engine/core/part-detector
 * Hybrid fuzzy + regex part detection engine with probability scoring.
 *
 * Scoring pipeline per mesh name:
 *   1. Exact token match       → +0.95 base
 *   2. Regex pattern match     → +0.80 base
 *   3. Fuzzy token similarity  → 0..0.70 (Levenshtein + Jaccard)
 *   4. Weight multiplier       → from taxonomy definition
 *   5. Final score = max(exact, regex, fuzzy) * weight, clamped to [0,1]
 *
 * Threshold filtering: only matches ≥ threshold are returned.
 */

import { PART_TAXONOMY } from './part-taxonomy.js'

// ─── String Utilities ───────────────────────────────────────────────────────

/**
 * Normalize a mesh name into comparable tokens.
 * Handles: camelCase, PascalCase, snake_case, kebab-case, dot.case, spaces.
 * Strips Blender suffixes (.001, .002), numeric indices.
 *
 * @param {string} name
 * @returns {string[]} Lowercase tokens
 */
export function tokenize(name) {
  if (!name) return []
  let cleaned = name
    .replace(/\.\d{3,}$/g, '')       // Remove Blender .001 suffixes
    .replace(/\d+$/g, '')            // Remove trailing numbers
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → camel_Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2') // XMLParser → XML_Parser
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')      // Non-alphanum → underscore
    .replace(/_+/g, '_')             // Collapse underscores
    .replace(/^_|_$/g, '')           // Trim underscores

  return cleaned.split('_').filter((t) => t.length > 0)
}

/**
 * Levenshtein edit distance (optimized single-row DP).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const la = a.length, lb = b.length
  // Single-row DP
  let prev = new Array(lb + 1)
  let curr = new Array(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j

  for (let i = 1; i <= la; i++) {
    curr[0] = i
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[lb]
}

/**
 * Normalized Levenshtein similarity ∈ [0, 1].
 * 1.0 = identical, 0.0 = completely different.
 */
export function levenshteinSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1.0
  return 1.0 - levenshtein(a, b) / maxLen
}

/**
 * Jaccard similarity of two token sets.
 * |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(tokensA, tokensB) {
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Character n-gram similarity.
 * @param {string} a
 * @param {string} b
 * @param {number} [n=2] - n-gram size (bigram by default)
 * @returns {number} Similarity ∈ [0, 1]
 */
export function ngramSimilarity(a, b, n = 2) {
  if (a.length < n || b.length < n) return levenshteinSimilarity(a, b)
  const ngrams = (s) => {
    const set = new Set()
    for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n))
    return set
  }
  const gramsA = ngrams(a.toLowerCase())
  const gramsB = ngrams(b.toLowerCase())
  let intersection = 0
  for (const g of gramsA) if (gramsB.has(g)) intersection++
  const union = gramsA.size + gramsB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ─── Scoring Functions ──────────────────────────────────────────────────────

/**
 * Score a mesh name against a single part definition.
 * Returns a structured score with breakdown.
 *
 * @param {string} meshName - Raw mesh name
 * @param {import('./part-taxonomy.js').PartDefinition} partDef
 * @returns {{ score: number, method: string, breakdown: object }}
 */
export function scoreMeshAgainstPart(meshName, partDef) {
  const nameLower = meshName.toLowerCase()
  const nameNormalized = nameLower.replace(/[^a-z0-9]/g, '')
  const nameTokens = tokenize(meshName)

  let bestScore = 0
  let bestMethod = 'none'
  const breakdown = { exact: 0, regex: 0, fuzzy: 0, jaccard: 0, ngram: 0 }

  // 1. Exact token match — highest confidence
  for (const token of partDef.exactTokens) {
    const tokenNorm = token.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (nameNormalized === tokenNorm || nameLower === token.toLowerCase()) {
      breakdown.exact = 0.95
      bestScore = 0.95
      bestMethod = 'exact'
      break
    }
    // Also check if the exact token appears as a substring
    if (nameNormalized.includes(tokenNorm) && tokenNorm.length >= 4) {
      const subScore = 0.85 * (tokenNorm.length / nameNormalized.length)
      if (subScore > breakdown.exact) {
        breakdown.exact = Math.min(subScore, 0.90)
        if (breakdown.exact > bestScore) { bestScore = breakdown.exact; bestMethod = 'exact_sub' }
      }
    }
  }

  // 2. Regex pattern match
  for (const pattern of partDef.regexPatterns) {
    if (pattern.test(meshName) || pattern.test(nameLower)) {
      breakdown.regex = 0.80
      if (breakdown.regex > bestScore) { bestScore = breakdown.regex; bestMethod = 'regex' }
      break
    }
  }

  // 3. Fuzzy token similarity (Jaccard + Levenshtein + n-gram)
  if (partDef.fuzzyTokens.length > 0 && nameTokens.length > 0) {
    // Jaccard on token sets
    breakdown.jaccard = jaccardSimilarity(nameTokens, partDef.fuzzyTokens) * 0.65

    // Best Levenshtein match per fuzzy token
    let levSum = 0
    let levCount = 0
    for (const ft of partDef.fuzzyTokens) {
      let bestLev = 0
      for (const nt of nameTokens) {
        bestLev = Math.max(bestLev, levenshteinSimilarity(nt, ft))
      }
      levSum += bestLev
      levCount++
    }
    const avgLev = levCount > 0 ? levSum / levCount : 0

    // N-gram on full name vs joined fuzzy tokens
    breakdown.ngram = ngramSimilarity(nameLower, partDef.fuzzyTokens.join('')) * 0.55

    // Combined fuzzy score
    breakdown.fuzzy = Math.min(0.70, Math.max(breakdown.jaccard, avgLev * 0.65, breakdown.ngram))

    if (breakdown.fuzzy > bestScore) { bestScore = breakdown.fuzzy; bestMethod = 'fuzzy' }
  }

  // 4. Apply weight
  const finalScore = Math.min(1.0, bestScore * partDef.weight)

  return { score: finalScore, method: bestMethod, breakdown }
}

// ─── Full Detection ─────────────────────────────────────────────────────────

/**
 * Detect all probable part assignments for a set of mesh names.
 *
 * @param {string[]} meshNames - All mesh names from the scene
 * @param {number} [threshold=0.45] - Minimum score to include
 * @param {typeof PART_TAXONOMY} [taxonomy=PART_TAXONOMY]
 * @returns {DetectionResult[]} Sorted by score (highest first)
 */
export function detectParts(meshNames, threshold = 0.45, taxonomy = PART_TAXONOMY) {
  const results = []

  for (const meshName of meshNames) {
    if (!meshName || meshName === '__unnamed__') continue

    const candidates = []
    for (const partDef of taxonomy) {
      const { score, method, breakdown } = scoreMeshAgainstPart(meshName, partDef)
      if (score >= threshold) {
        candidates.push({
          meshName,
          typeKey: partDef.typeKey,
          label: partDef.label,
          category: partDef.category,
          score,
          method,
          breakdown,
          defaultInteraction: partDef.defaultInteraction,
          defaultAxis: partDef.defaultAxis,
          defaultOpenAngle: partDef.defaultOpenAngle,
        })
      }
    }

    // Sort candidates by score desc, take best match
    candidates.sort((a, b) => b.score - a.score)
    if (candidates.length > 0) {
      results.push({
        ...candidates[0],
        alternates: candidates.slice(1, 4), // top 3 alternatives
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results
}

/**
 * Classify a single mesh name against the taxonomy.
 * Returns the best match or null if below threshold.
 *
 * @param {string} meshName
 * @param {number} [threshold=0.45]
 * @returns {DetectionResult | null}
 */
export function classifyMesh(meshName, threshold = 0.45) {
  const results = detectParts([meshName], threshold)
  return results.length > 0 ? results[0] : null
}

/**
 * Batch classify all meshes from a mesh index (from mesh-traversal).
 * Returns a Map of typeKey → matched meshes with scores.
 *
 * @param {Map<string, any[]>} meshIndex - From indexMeshesByName()
 * @param {number} [threshold=0.45]
 * @returns {{ detections: DetectionResult[], partMap: Map<string, DetectionResult[]>, unmatched: string[] }}
 */
export function classifyScene(meshIndex, threshold = 0.45) {
  const meshNames = [...meshIndex.keys()].filter((k) => k !== '__all__')
  const detections = detectParts(meshNames, threshold)

  const partMap = new Map()
  const matchedNames = new Set()

  for (const det of detections) {
    matchedNames.add(det.meshName)
    if (!partMap.has(det.typeKey)) partMap.set(det.typeKey, [])
    partMap.get(det.typeKey).push(det)
  }

  const unmatched = meshNames.filter((n) => !matchedNames.has(n))

  return { detections, partMap, unmatched }
}

/**
 * @typedef {object} DetectionResult
 * @property {string} meshName
 * @property {string} typeKey
 * @property {string} label
 * @property {string} category
 * @property {number} score - 0..1 probability
 * @property {string} method - 'exact'|'exact_sub'|'regex'|'fuzzy'|'none'
 * @property {object} breakdown
 * @property {string} defaultInteraction
 * @property {number[]|null} defaultAxis
 * @property {number} defaultOpenAngle
 * @property {DetectionResult[]} [alternates] - Other possible matches
 */
