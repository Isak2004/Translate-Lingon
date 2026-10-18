// Svenska namn på språkkoder i PDH:s locale-filer. Okända koder visas som de är.
const NAMES: Record<string, string> = {
  sv: 'Svenska', en: 'Engelska', de: 'Tyska', da: 'Danska', fi: 'Finska',
  nb: 'Norska (bokmål)', no: 'Norska', nl: 'Nederländska', fr: 'Franska',
  es: 'Spanska', it: 'Italienska', pl: 'Polska', pt: 'Portugisiska',
};

export function languageName(code: string): string {
  return NAMES[code] ?? NAMES[code.split('-')[0]] ?? code;
}
