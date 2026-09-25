// Keep the raw text until validation; Number() alone accepts whitespace and exponent notation.
export function parseTonnage(input: string): number | null {
  const value = input.trim();
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 && quantity < 100000000 ? quantity : null;
}
