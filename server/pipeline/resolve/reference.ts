/**
 * Reference routing.
 *
 * A bare "ref no" always means `transaction_reference_id`, which is plaintext
 * and searchable. `utr_number` is sensitive and may be encrypted, so it is only
 * searched when the user says UTR outright.
 */
import type { RefField } from '../types.js';

const UTR_WORDS = /\b(utr|utr number|utr no|unique transaction reference)\b/i;

/** Decides which column a reference question should hit. */
export function resolveRefField(question: string, mentionsUtr?: boolean | null): RefField {
  if (mentionsUtr) return 'utr';
  return UTR_WORDS.test(question) ? 'utr' : 'reference_id';
}

/**
 * Pulls a reference token out of free text when the model did not isolate one.
 * References in the data look like `HDFCH01078329532`, `S69244711` or a long
 * digit run, so we take the longest alphanumeric run that is not a plain word.
 */
export function extractReference(text: string): string | null {
  const candidates = text.match(/\b[A-Za-z]*\d[A-Za-z0-9]{5,}\b/g);
  if (!candidates?.length) return null;
  return candidates.sort((a, b) => b.length - a.length)[0];
}
