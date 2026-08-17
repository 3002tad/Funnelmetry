function scalar(value) {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null" || trimmed === "~") return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function stripComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if ((char === '"' || char === "'") && (index === 0 || line[index - 1] !== "\\")) {
      quote = quote === char ? null : quote ?? char
    }
    if (char === "#" && !quote) return line.slice(0, index)
  }
  return line
}

/**
 * Deliberately small, safe YAML subset for the checked-in integration manifest:
 * mappings, scalar lists and scalar values. JSON is accepted too because it is
 * valid YAML. Unsupported YAML fails closed instead of being guessed.
 */
export function parseManifestYaml(text) {
  const input = text.trim()
  if (!input) throw new Error("Manifest is empty")
  if (input.startsWith("{")) return JSON.parse(input)

  const lines = input
    .split(/\r?\n/)
    .map((line, lineNumber) => ({ raw: stripComment(line), lineNumber: lineNumber + 1 }))
    .filter(({ raw }) => raw.trim() !== "")

  if (lines.some(({ raw }) => raw.includes("\t"))) {
    throw new Error("Tabs are not supported in YAML indentation")
  }

  const tokens = lines.map(({ raw, lineNumber }) => {
    const indent = raw.length - raw.trimStart().length
    return { indent, text: raw.trim(), lineNumber }
  })

  function block(start, indent) {
    if (start >= tokens.length) return [{}, start]
    const isList = tokens[start].indent === indent && tokens[start].text.startsWith("- ")
    const result = isList ? [] : {}
    let index = start

    while (index < tokens.length && tokens[index].indent === indent) {
      const token = tokens[index]
      if (isList) {
        if (!token.text.startsWith("- ")) throw new Error(`Mixed YAML list/map at line ${token.lineNumber}`)
        const item = token.text.slice(2).trim()
        if (!item) throw new Error(`Nested list items are not supported at line ${token.lineNumber}`)
        result.push(scalar(item))
        index += 1
        continue
      }

      if (token.text.startsWith("- ")) throw new Error(`Mixed YAML list/map at line ${token.lineNumber}`)
      const match = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(token.text)
      if (!match) throw new Error(`Invalid YAML mapping at line ${token.lineNumber}`)
      const [, rawKey, rawValue = ""] = match
      const key = rawKey.trim()
      if (Object.hasOwn(result, key)) throw new Error(`Duplicate key '${key}' at line ${token.lineNumber}`)
      index += 1
      if (rawValue.trim() !== "") {
        result[key] = scalar(rawValue)
        continue
      }
      if (index >= tokens.length || tokens[index].indent <= indent) {
        result[key] = {}
        continue
      }
      ;[result[key], index] = block(index, tokens[index].indent)
    }
    return [result, index]
  }

  const [parsed, end] = block(0, tokens[0].indent)
  if (end !== tokens.length) throw new Error(`Unexpected YAML indentation at line ${tokens[end].lineNumber}`)
  return parsed
}
