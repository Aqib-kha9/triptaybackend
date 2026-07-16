/**
 * Generates a URL-safe slug from a string.
 * e.g. "Luxury Villa in Goa" → "luxury-villa-in-goa"
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Given a base slug, queries a Prisma model to ensure uniqueness.
 * Returns a unique slug, appending a counter suffix if needed.
 */
export async function ensureUniqueSlug(
  baseSlug: string,
  findFn: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  while (await findFn(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
}