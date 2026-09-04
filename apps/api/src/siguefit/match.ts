/** Fuzzy-but-conservative matching of SigueFit names to platform users. */

export interface MatchUser {
  id: string;
  name: string | null;
}

export interface UnmatchedName {
  rawName: string;
  candidates?: string[];
}

export interface MatchResult {
  /** rawName -> userId, only when exactly one sensible user was found. */
  matched: Map<string, string>;
  unmatched: UnmatchedName[];
}

export function normalizeName(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const tokensOf = (norm: string): string[] => (norm ? norm.split(' ') : []);
const endsKey = (tokens: string[]): string =>
  tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length - 1]}` : '';

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );
  for (let i = 0; i < rows; i += 1) dist[i][0] = i;
  for (let j = 0; j < cols; j += 1) dist[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + cost,
      );
    }
  }
  return dist[rows - 1][cols - 1];
}

interface Indexed {
  id: string;
  name: string;
  norm: string;
  tokens: string[];
}

export function matchStudents(
  rawNames: string[],
  users: MatchUser[],
): MatchResult {
  const indexed: Indexed[] = users
    .filter((u): u is { id: string; name: string } =>
      Boolean(u.name && u.name.trim()),
    )
    .map((u) => {
      const norm = normalizeName(u.name);
      return { id: u.id, name: u.name, norm, tokens: tokensOf(norm) };
    });

  const byFull = new Map<string, Indexed[]>();
  const byEnds = new Map<string, Indexed[]>();
  for (const entry of indexed) {
    push(byFull, entry.norm, entry);
    const ek = endsKey(entry.tokens);
    if (ek) push(byEnds, ek, entry);
  }

  const matched = new Map<string, string>();
  const unmatched: UnmatchedName[] = [];
  const seen = new Set<string>();

  for (const rawName of rawNames) {
    if (seen.has(rawName)) continue;
    seen.add(rawName);

    const norm = normalizeName(rawName);
    if (!norm) {
      unmatched.push({ rawName });
      continue;
    }
    const tokens = tokensOf(norm);

    const exact = byFull.get(norm);
    if (exact?.length === 1) {
      matched.set(rawName, exact[0].id);
      continue;
    }
    if (exact && exact.length > 1) {
      unmatched.push({ rawName, candidates: exact.map((e) => e.name) });
      continue;
    }

    const ends = byEnds.get(endsKey(tokens));
    if (ends?.length === 1) {
      matched.set(rawName, ends[0].id);
      continue;
    }
    if (ends && ends.length > 1) {
      unmatched.push({ rawName, candidates: ends.map((e) => e.name) });
      continue;
    }

    const querySet = new Set(tokens);
    const subset = indexed.filter((entry) => {
      const entrySet = new Set(entry.tokens);
      return isSubset(querySet, entrySet) || isSubset(entrySet, querySet);
    });
    if (subset.length === 1) {
      matched.set(rawName, subset[0].id);
      continue;
    }
    if (subset.length > 1) {
      unmatched.push({ rawName, candidates: subset.map((e) => e.name) });
      continue;
    }

    unmatched.push({ rawName, candidates: closest(norm, tokens, indexed) });
  }

  return { matched, unmatched };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function closest(norm: string, tokens: string[], indexed: Indexed[]): string[] {
  const scored = indexed
    .map((entry) => {
      const overlap = entry.tokens.filter((t) => tokens.includes(t)).length;
      return { name: entry.name, overlap, dist: levenshtein(norm, entry.norm) };
    })
    .filter((s) => s.overlap > 0 || s.dist <= 3)
    .sort((a, b) => b.overlap - a.overlap || a.dist - b.dist);
  return scored.slice(0, 3).map((s) => s.name);
}
