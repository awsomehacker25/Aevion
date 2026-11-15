/**
 * Month names for languages the browser has no date data for (Assamese and Hawaiian show English month names otherwise).
 * Every other language is formatted by the browser itself.
 */
const NAMES: Record<string, { long: string[]; short: string[] }> = {
  as: {
    long: ['জানুৱাৰী', 'ফেব্ৰুৱাৰী', 'মাৰ্চ', 'এপ্ৰিল', 'মে’', 'জুন', 'জুলাই', 'আগষ্ট', 'ছেপ্তেম্বৰ', 'অক্টোবৰ', 'নৱেম্বৰ', 'ডিচেম্বৰ'],
    short: ['জানু', 'ফেব্ৰু', 'মাৰ্চ', 'এপ্ৰিল', 'মে’', 'জুন', 'জুলাই', 'আগ', 'ছেপ্ত', 'অক্টো', 'নৱে', 'ডিচে'],
  },
  haw: {
    long: ['Ianuali', 'Pepeluali', 'Malaki', 'ʻApelila', 'Mei', 'Iune', 'Iulai', 'ʻAukake', 'Kepakemapa', 'ʻOkakopa', 'Nowemapa', 'Kekemapa'],
    short: ['Ian', 'Pep', 'Mal', 'ʻApe', 'Mei', 'Iun', 'Iul', 'ʻAuk', 'Kep', 'ʻOka', 'Now', 'Kek'],
  },
}

export const hasMonthNames = (lang: string) => lang in NAMES

export interface DateParts {
  month?: 'short' | 'long' | 'numeric' | '2-digit'
  day?: 'numeric' | '2-digit'
  year?: 'numeric' | '2-digit'
}

/** "22 Iulai 2026" in the language's own month names, or null when the language is formatted by the browser. Times are UTC. */
export function formatCustomDate(time: number, lang: string, o: DateParts = { month: 'short', day: 'numeric', year: 'numeric' }): string | null {
  const names = NAMES[lang]
  if (!names) return null
  const d = new Date(time)
  const parts: string[] = []
  if (o.day) parts.push(String(d.getUTCDate()))
  if (o.month) parts.push(o.month === 'long' ? names.long[d.getUTCMonth()] : o.month === 'short' ? names.short[d.getUTCMonth()] : String(d.getUTCMonth() + 1))
  if (o.year) parts.push(o.year === '2-digit' ? String(d.getUTCFullYear()).slice(2) : String(d.getUTCFullYear()))
  return parts.join(' ')
}
