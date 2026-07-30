// Budowniczy zapytań OSINT z KOTWICAMI (anchors) — koniec z szukaniem „na ślepo".
//
// Zasada: osoby fizycznej NIGDY nie szukamy po samym imieniu i nazwisku („wszyscy
// Jan Kowalscy"), tylko zawsze w koniunkcji z daną dyskryminującą z materiału sprawy:
// emitentem, spółką z rostera, numerem KRS, instrumentem, miejscowością. PESEL jest
// w aktach, ale NIE służy do wyszukiwania publicznego (nieindeksowany, dane wrażliwe)
// — służy biegłemu do weryfikacji tożsamości trafień.
//
// Używane wspólnie przez panel OSINT (przyciski) i agenta (etap gather/search),
// żeby oba tory szukały tak samo metodycznie.

export type Anchors = {
  emitter?: string; // nazwa emitenta / sprawy (np. ZASTAL)
  instruments?: string[]; // symbole instrumentów (CSY, RSY…)
  companies?: string[]; // spółki z rostera (kotwice dla osób)
  cities?: string[]; // miejscowości z KRS/GLEIF
  sig?: string; // sygnatura sprawy (do wyszukiwań orzeczeń)
};

const q = (s: string) => `"${s.trim()}"`;
const clean = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

/** Kotwice sprawy z rostera + nazwy sprawy (+ opcjonalnie miasta z rejestrów). */
export function buildAnchors(
  caseName: string,
  roster: { name: string; kind?: string }[],
  extra?: Partial<Anchors>,
): Anchors {
  const companies = roster
    .filter((e) => (e.kind ?? "podmiot") !== "osoba")
    .map((e) => clean(e.name))
    .filter((n) => n.length >= 3)
    .slice(0, 6);
  return {
    emitter: clean(caseName || ""),
    companies,
    instruments: extra?.instruments ?? [],
    cities: extra?.cities ?? [],
    sig: extra?.sig,
  };
}

/** Zapytania dla OSOBY — zawsze z kotwicą; warianty od najmocniejszej. */
export function personQueries(name: string, a: Anchors, cap = 3): string[] {
  const n = q(clean(name));
  const out: string[] = [];
  if (a.emitter) out.push(`${n} ${q(a.emitter)}`); // osoba + emitent
  for (const c of a.companies ?? []) {
    if (clean(c).toLowerCase() !== clean(name).toLowerCase()) out.push(`${n} ${q(c)}`); // osoba + spółka z rostera
  }
  for (const i of a.instruments ?? []) out.push(`${n} ${i} akcje`); // osoba + instrument
  out.push(`${n} KRS zarząd`); // osoba + rola rejestrowa
  for (const m of a.cities ?? []) out.push(`${n} ${q(m)}`);
  return [...new Set(out)].slice(0, cap);
}

/** Zapytania dla PODMIOTU — nazwa w cudzysłowie + kontekst rejestrowy/emitent. */
export function entityQueries(name: string, a: Anchors, cap = 3): string[] {
  const n = q(clean(name));
  const out: string[] = [`${n} KRS zarząd`, `${n} beneficjent rzeczywisty`];
  if (a.emitter && clean(name).toLowerCase() !== a.emitter.toLowerCase()) out.push(`${n} ${q(a.emitter)}`);
  for (const i of a.instruments ?? []) out.push(`${n} ${i}`);
  return [...new Set(out)].slice(0, cap);
}

/** Para (osoba↔osoba / osoba↔spółka) — oba człony w cudzysłowie + opcjonalna kotwica. */
export function pairQuery(x: string, y: string, a?: Anchors): string {
  const base = `${q(clean(x))} ${q(clean(y))}`;
  return a?.emitter ? `${base} OR (${q(clean(x))} ${q(clean(y))} ${q(a.emitter)})` : base;
}

// ── Zakresy wyszukiwania (operator site:) ──────────────────────────────────
// Rejestry publiczne — trafienia rejestrowe zamiast szumu ogólnego.
export const REGISTRY_SITES = [
  "rejestr.io", "aleo.com", "krs-pobierz.pl", "krs-online.com.pl", "imsig.pl",
  "opencorporates.com", "ekrs.ms.gov.pl", "biznesradar.pl",
];
// 15 portali biznesowo-giełdowych (zad. 4) — podzielone na 2 grupy, bo długi ciąg
// OR-ów obniża jakość wyników Brave; wyszukiwanie robi 2 przebiegi i scala.
export const BUSINESS_SITES_A = [
  "bankier.pl", "biznes.pap.pl", "infostrefa.com", "stockwatch.pl",
  "biznesradar.pl", "parkiet.com", "pb.pl", "money.pl",
];
export const BUSINESS_SITES_B = [
  "strefainwestorow.pl", "stooq.pl", "aleo.com", "rejestr.io",
  "bizraport.pl", "imsig.pl", "wnp.pl",
];

export function withSites(query: string, sites: string[]): string {
  return `${query} (${sites.map((s) => `site:${s}`).join(" OR ")})`;
}
