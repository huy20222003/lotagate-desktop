/** Validates and normalizes zero-based PDF page selections at one boundary. */
export function requestedPdfPages(params: Record<string, unknown>, maxPages?: number): number[] | undefined {
  const value = params['pages'];
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return undefined;
  if (!Array.isArray(value)) throw new Error('PDF pages must be an array of zero-based page indexes.');
  if (value.some(page => typeof page !== 'number' || !Number.isInteger(page) || page < 0)) throw new Error('PDF pages must be unique non-negative integers.');
  const pages = value as number[];
  if (maxPages !== undefined && pages.length > maxPages) throw new Error(`PDF pages must contain no more than ${String(maxPages)} entries.`);
  if (new Set(pages).size !== pages.length) throw new Error('PDF pages must be unique non-negative integers.');
  return [...pages].sort((left, right) => left - right);
}

/** Returns the normalized page selection as a set for membership checks. */
export function requestedPdfPageSet(params: Record<string, unknown>, maxPages?: number): Set<number> | undefined {
  const pages = requestedPdfPages(params, maxPages);
  return pages === undefined ? undefined : new Set(pages);
}
