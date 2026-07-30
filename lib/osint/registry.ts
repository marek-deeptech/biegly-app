// Rejestry publiczne do OSINT (zad. 3) — katalog źródeł + kolektor KRS (api-krs).
//
// Dwie warstwy:
//  1) KOLEKTORY z API (deterministyczne, cytowalne): KRS odpis aktualny (Ministerstwo
//     Sprawiedliwości, bez klucza) — OBOWIĄZKOWY etap agenta; GLEIF jest w collect.ts.
//  2) KATALOG rejestrów z szablonami URL — panel renderuje linki per podmiot/osoba
//     (przeszukanie ręczne tam, gdzie brak publicznego API albo trzeba CAPTCHA).
//
// Zasada evidence-only: każdy rekord z kolektora niesie source do zacytowania.

export type KrsCompany = {
  nazwa: string;
  forma: string;
  krs: string;
  nip: string;
  regon: string;
  adres: string;
  email?: string;
  www?: string;
  stanZDnia: string;
};
export type KrsPerson = { funkcja: string; osoba: string };
export type KrsOdpis = { company: KrsCompany; persons: KrsPerson[]; source: string };

function pick(o: unknown, ...keys: string[]): unknown {
  let c: unknown = o;
  for (const k of keys) {
    if (c && typeof c === "object" && k in (c as Record<string, unknown>)) c = (c as Record<string, unknown>)[k];
    else return undefined;
  }
  return c;
}
const str = (x: unknown): string => (x == null ? "" : String(x));

async function fetchReg(krs: string, rejestr: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}?rejestr=${rejestr}&format=json`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Odpis aktualny KRS (rejestr P, fallback S) — dane spółki + skład organów.
 *  Uwaga: rejestr publiczny maskuje PESEL/daty urodzenia; pełne dane są w odpisach z akt. */
export async function fetchKrsOdpis(krsRaw: string): Promise<KrsOdpis | null> {
  const krs = krsRaw.replace(/\D/g, "").padStart(10, "0");
  if (!/^\d{10}$/.test(krs)) return null;
  let d = await fetchReg(krs, "P");
  if (!pick(d, "odpis")) d = await fetchReg(krs, "S");
  if (!pick(d, "odpis")) return null;

  const a = pick(d, "odpis", "dane", "dzial1", "siedzibaIAdres", "adres");
  const adres = [pick(a, "ulica"), pick(a, "nrDomu"), pick(a, "nrLokalu"), pick(a, "kodPocztowy"), pick(a, "miejscowosc")]
    .map(str)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  // Realne kształty API (zbadane empirycznie): grupa bywa OBIEKTEM {sklad:[…]} albo LISTĄ
  // takich obiektów (organNadzoru); funkcja to „funkcjaWOrganie" (nie „funkcja"); imię/nazwisko
  // zagnieżdżone (imiona.imie, nazwisko.nazwiskoICzlon) — a dane osobowe są MASKOWANE
  // gwiazdkami w publicznym API (pełne dane tylko w wyszukiwarce KRS / odpisie z akt).
  const persons: KrsPerson[] = [];
  const addSklad = (grupaKey: string, label: string) => {
    const grupa = pick(d, "odpis", "dane", "dzial2", grupaKey);
    const bloki = Array.isArray(grupa) ? grupa : [grupa];
    for (const blok of bloki) {
      const sklad = pick(blok, "sklad");
      if (!Array.isArray(sklad)) continue;
      for (const p of sklad) {
        const nazRaw = pick(p, "nazwisko");
        const naz = typeof nazRaw === "string" ? nazRaw : str(pick(nazRaw, "nazwiskoICzlon"));
        const imRaw = pick(p, "imiona");
        const im = typeof imRaw === "string" ? imRaw : str(pick(imRaw, "imie"));
        const osoba = `${im} ${naz}`.trim();
        if (osoba) persons.push({ funkcja: str(pick(p, "funkcjaWOrganie") ?? pick(p, "funkcja")) || label, osoba });
      }
    }
  };
  addSklad("reprezentacja", "reprezentacja");
  addSklad("organNadzoru", "organ nadzoru");
  addSklad("prokurenci", "prokurent");

  const stan = str(pick(d, "odpis", "naglowekA", "stanZDnia"));
  return {
    company: {
      nazwa: str(pick(d, "odpis", "dane", "dzial1", "danePodmiotu", "nazwa")),
      forma: str(pick(d, "odpis", "dane", "dzial1", "danePodmiotu", "formaPrawna")),
      krs,
      nip: str(pick(d, "odpis", "dane", "dzial1", "danePodmiotu", "identyfikatory", "nip")),
      regon: str(pick(d, "odpis", "dane", "dzial1", "danePodmiotu", "identyfikatory", "regon")),
      adres,
      email: str(pick(d, "odpis", "dane", "dzial1", "siedzibaIAdres", "adresPocztyElektronicznej")),
      www: str(pick(d, "odpis", "dane", "dzial1", "siedzibaIAdres", "adresStronyInternetowej")),
      stanZDnia: stan,
    },
    persons,
    source: `KRS ${krs} — odpis aktualny (api-krs.ms.gov.pl), stan z ${stan || "—"}`,
  };
}

/** Numery KRS z tekstu akt: tylko jawnie oznaczone („KRS 0000123456"), nie gołe ciągi cyfr. */
export function extractKrsNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/KRS[\s:.]*((?:\d[\s]?){10})/gi)) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length === 10) out.add(digits);
  }
  return [...out];
}

/** Zwięzły tekst odpisu do bloku dowodowego agenta. */
export function fmtKrs(rec: KrsOdpis): string {
  const c = rec.company;
  const organy = rec.persons.map((p) => `${p.osoba} (${p.funkcja})`).join("; ");
  return [
    `- ${c.nazwa} | KRS ${c.krs} | NIP ${c.nip || "—"} | REGON ${c.regon || "—"} | ${c.adres}`,
    organy ? `  organy: ${organy}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── KATALOG rejestrów publicznych (linki per podmiot/osoba w panelu) ──────────
export type RegistrySource = {
  id: string;
  label: string;
  what: string; // co daje (tooltip)
  q: (term: string) => string | null; // URL wyszukiwania (null = brak wyszukiwarki po nazwie)
  forPersons?: boolean; // sensowne też dla osób fizycznych
};

const enc = encodeURIComponent;
export const REGISTRY_CATALOG: RegistrySource[] = [
  { id: "rejestr_io", label: "rejestr.io", what: "graf powiązań KRS: osoba ↔ spółki, historia zarządów", forPersons: true,
    q: (t) => `https://rejestr.io/szukaj?text=${enc(t)}` },
  { id: "ekrs", label: "wyszukiwarka KRS", what: "oficjalna wyszukiwarka podmiotów KRS (MS)", forPersons: false,
    q: () => "https://wyszukiwarka-krs.ms.gov.pl/" },
  { id: "rdf", label: "eKRS: dok. finansowe", what: "sprawozdania finansowe spółki (bezpłatnie, po nr KRS)", forPersons: false,
    q: () => "https://ekrs.ms.gov.pl/rdf/pd/search_df" },
  { id: "aleo", label: "ALEO", what: "profil firmy, powiązania osób, dane rejestrowe (ING)", forPersons: true,
    q: (t) => `https://aleo.com/pl/firmy?phrase=${enc(t)}` },
  { id: "crbr", label: "CRBR", what: "beneficjenci rzeczywiści spółki (po NIP/nazwie)", forPersons: false,
    q: () => "https://crbr.podatki.gov.pl/adcrbr/#/wyszukaj" },
  { id: "bialalista", label: "Biała lista VAT", what: "status VAT + numery rachunków bankowych (po NIP)", forPersons: false,
    q: () => "https://www.podatki.gov.pl/wykaz-podatnikow-vat-wyszukiwarka" },
  { id: "imsig", label: "iMSiG", what: "Monitor Sądowy i Gospodarczy: ogłoszenia, upadłości, zmiany wpisów", forPersons: true,
    q: (t) => `https://www.imsig.pl/szukaj/osoba,${enc(t)}` },
  { id: "krz", label: "KRZ", what: "Krajowy Rejestr Zadłużonych: upadłości, restrukturyzacje, zakazy", forPersons: true,
    q: () => "https://prs.ms.gov.pl/krz" },
  { id: "saos", label: "SAOS (orzeczenia)", what: "wyszukiwarka orzeczeń sądów z pełnym tekstem", forPersons: true,
    q: (t) => `https://www.saos.org.pl/search?q=${enc(t)}` },
  { id: "knf_ostrz", label: "KNF: ostrzeżenia", what: "lista ostrzeżeń publicznych KNF", forPersons: true,
    q: () => "https://www.knf.gov.pl/dla_konsumenta/ostrzezenia_publiczne" },
  { id: "opencorp", label: "OpenCorporates", what: "rejestry zagraniczne (CY/UK/EU) — spółki offshore", forPersons: true,
    q: (t) => `https://opencorporates.com/companies?q=${enc(t)}` },
  { id: "ceidg", label: "CEIDG", what: "działalności gospodarcze osób fizycznych", forPersons: true,
    q: () => "https://aplikacja.ceidg.gov.pl/ceidg/ceidg.public.ui/search.aspx" },
];

export function registryLinks(term: string, person: boolean): { label: string; url: string; what: string }[] {
  return REGISTRY_CATALOG.filter((s) => (person ? s.forPersons !== false : true))
    .map((s) => ({ label: s.label, url: s.q(term) ?? "", what: s.what }))
    .filter((l) => l.url);
}
