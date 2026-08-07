/** Configurable rules for the « risques critiques » KPI (secrets leak / takeover / grades…). */

export type CyberRiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface CyberRiskFindingMatcher {
  /** Exact finding code, e.g. misconfig.exposed_path */
  code: string;
  /**
   * Severities that match. Empty / missing = any severity.
   * Prefer explicit lists for exposed_path (high+).
   */
  severities?: CyberRiskSeverity[];
}

export interface CyberExtremeRiskRules {
  /** Short label shown under the KPI tile */
  label: string;
  findingMatchers: CyberRiskFindingMatcher[];
  /** Site grades that alone flag the site (e.g. ["F","E"]) */
  grades: string[];
}

export const DEFAULT_EXTREME_RISK_RULES: CyberExtremeRiskRules = {
  label: 'Fuites de secrets & takeovers',
  findingMatchers: [
    { code: 'misconfig.exposed_path', severities: ['high', 'critical'] },
    { code: 'takeover.vulnerable' },
    { code: 'takeover.dangling' },
  ],
  grades: [],
};

const SEVERITIES = new Set<string>(['info', 'low', 'medium', 'high', 'critical']);
const GRADES = new Set(['A+', 'A', 'B', 'C', 'D', 'E', 'F']);

export function normalizeExtremeRiskRules(raw: unknown): CyberExtremeRiskRules {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_EXTREME_RISK_RULES);
  }
  const obj = raw as Record<string, unknown>;

  const label =
    typeof obj.label === 'string' && obj.label.trim()
      ? obj.label.trim().slice(0, 120)
      : DEFAULT_EXTREME_RISK_RULES.label;

  const matchersRaw = Array.isArray(obj.findingMatchers) ? obj.findingMatchers : [];
  const findingMatchers: CyberRiskFindingMatcher[] = [];
  for (const m of matchersRaw) {
    if (!m || typeof m !== 'object') continue;
    const code = typeof (m as { code?: unknown }).code === 'string'
      ? (m as { code: string }).code.trim()
      : '';
    if (!code || code.length > 120) continue;
    const sevRaw = (m as { severities?: unknown }).severities;
    let severities: CyberRiskSeverity[] | undefined;
    if (Array.isArray(sevRaw)) {
      severities = sevRaw
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.toLowerCase())
        .filter((s): s is CyberRiskSeverity => SEVERITIES.has(s));
      if (severities.length === 0) severities = undefined;
    }
    findingMatchers.push(severities ? { code, severities } : { code });
  }

  const gradesRaw = Array.isArray(obj.grades) ? obj.grades : [];
  const grades = [
    ...new Set(
      gradesRaw
        .filter((g): g is string => typeof g === 'string')
        .map((g) => g.trim().toUpperCase())
        .filter((g) => GRADES.has(g)),
    ),
  ];

  // Empty matchers + empty grades would zero the KPI forever — fall back to defaults.
  if (findingMatchers.length === 0 && grades.length === 0) {
    return structuredClone(DEFAULT_EXTREME_RISK_RULES);
  }

  return { label, findingMatchers, grades };
}

export interface FindingSignal {
  code?: string;
  severity?: string;
}

/** Count findings that match the configured rules. */
export function countMatchingFindings(
  findings: FindingSignal[] | undefined,
  rules: CyberExtremeRiskRules,
): number {
  if (!findings?.length || !rules.findingMatchers.length) return 0;
  let n = 0;
  for (const f of findings) {
    const code = (f.code || '').trim();
    if (!code) continue;
    const sev = (f.severity || '').toLowerCase();
    for (const m of rules.findingMatchers) {
      if (m.code !== code) continue;
      if (!m.severities || m.severities.length === 0) {
        n += 1;
        break;
      }
      if (m.severities.includes(sev as CyberRiskSeverity)) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

export function gradeMatchesRules(
  grade: string | null | undefined,
  rules: CyberExtremeRiskRules,
): boolean {
  if (!grade || !rules.grades.length) return false;
  return rules.grades.includes(String(grade).trim().toUpperCase());
}
