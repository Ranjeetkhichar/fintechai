/**
 * Counterparty resolution.
 *
 * There is no vendor table. Counterparties live inside bank-statement text in
 * `transaction.description`, so Swiss Cheese keeps a small alias catalog and matches
 * with ILIKE. A name that hits more than one alias is reported as ambiguous
 * rather than silently resolved to the largest match.
 */

export interface CounterpartyAlias {
  key: string;
  /** Name Swiss Cheese prints. Never a name the model invented. */
  label: string;
  /** ILIKE fragment, wrapped in % by the SQL layer. */
  pattern: string;
  /** Extra spellings a user might type. */
  synonyms: string[];
}

export const ALIASES: CounterpartyAlias[] = [
  {
    key: 'selection_mobile',
    label: 'Selection Mobile',
    pattern: 'SELECTION MOBILE',
    synonyms: ['selection mobiles']
  },
  {
    key: 'selection_electronics',
    label: 'Selection Electronics, Dahisar East',
    pattern: 'SELECTION ELECTRONICS',
    synonyms: ['selection electronics dahisar']
  },
  {
    key: 'navyug_selection',
    label: 'Navyug Selection',
    pattern: 'NAVYUG SELECTION',
    synonyms: []
  },
  {
    key: 'umang_selection',
    label: 'Umang Selection, Hapur',
    pattern: 'UMANG SELECTION',
    synonyms: ['umang selection hapur']
  },
  {
    key: 'reliance_digital',
    label: 'Reliance Digital Retail Ltd',
    pattern: 'RELIANCEDIGITAL',
    synonyms: ['reliance digital', 'reliance digital retail', 'reliance']
  },
  {
    key: 'selectricity_two',
    label: 'Selectricity Two Private Limited',
    pattern: 'SELECTRICITY TWO',
    synonyms: ['selectricity']
  },
  {
    key: 'selection_maligai',
    label: 'Selection Maligai',
    pattern: 'SELECTIONMALIGAI',
    synonyms: ['selection maligai']
  }
];

export type CounterpartyResolution =
  | { ok: true; alias: CounterpartyAlias; confidence: number }
  | { ok: false; reason: 'ambiguous'; candidates: CounterpartyAlias[]; text: string }
  | { ok: false; reason: 'unknown'; text: string };

function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function aliasByKey(key: string): CounterpartyAlias | undefined {
  return ALIASES.find((a) => a.key === key);
}

/**
 * Matches a user's counterparty phrase against the catalog.
 * Exact hits win outright. A partial hit on several aliases is ambiguous, which
 * is the "which Selection did you mean" case.
 */
export function resolveCounterparty(text: string | null | undefined): CounterpartyResolution {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, reason: 'unknown', text: '' };

  const needle = normalize(raw);
  if (!needle) return { ok: false, reason: 'unknown', text: raw };

  const exact = ALIASES.filter((alias) => {
    const forms = [alias.label, alias.pattern, alias.key.replace(/_/g, ' '), ...alias.synonyms];
    return forms.some((form) => normalize(form) === needle);
  });
  if (exact.length === 1) return { ok: true, alias: exact[0], confidence: 1 };
  if (exact.length > 1) return { ok: false, reason: 'ambiguous', candidates: exact, text: raw };

  const partial = ALIASES.filter((alias) => {
    const forms = [alias.label, alias.pattern, ...alias.synonyms].map(normalize);
    return forms.some((form) => form.includes(needle) || needle.includes(form));
  });

  if (partial.length === 1) return { ok: true, alias: partial[0], confidence: 0.7 };
  if (partial.length > 1) return { ok: false, reason: 'ambiguous', candidates: partial, text: raw };

  return { ok: false, reason: 'unknown', text: raw };
}
