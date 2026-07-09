// Kolektory źródeł OSINT (serwerowo) — Brave Search + GLEIF. Funkcje czyste
// (bez self-HTTP), reużywane przez agenta (lib/osint/agent.ts). Evidence-only:
// zwracają realne wyniki z URL-em/identyfikatorem, które agent cytuje jako źródło.

export type WebHit = { title: string; url: string; description: string };
export type GleifRecord = {
  lei: string;
  name: string;
  status: string; // ACTIVE / LAPSED / RETIRED / INACTIVE …
  jurisdiction: string;
  address: string;
  registeredAs?: string; // numer w rejestrze krajowym
};

const BRAVE = "https://api.search.brave.com/res/v1/web/search";
const GLEIF = "https://api.gleif.org/api/v1/lei-records";

// ── Brave Search ── (klucz z env; brak → pusto, agent działa dalej na aktach/GLEIF)
export async function braveSearch(query: string, social = false): Promise<WebHit[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  const q = social
    ? `${query} (site:linkedin.com OR site:x.com OR site:facebook.com)`
    : query;
  try {
    const r = await fetch(`${BRAVE}?q=${encodeURIComponent(q)}&count=8`, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      cache: "no-store",
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (j.web?.results ?? [])
      .map((x) => ({ title: (x.title || "").trim(), url: (x.url || "").trim(), description: (x.description || "").trim() }))
      .filter((x) => x.url)
      .slice(0, 6);
  } catch {
    return [];
  }
}

// ── GLEIF: rekord po LEI ──
export async function gleifByLei(lei: string): Promise<GleifRecord | null> {
  try {
    const r = await fetch(`${GLEIF}/${encodeURIComponent(lei)}`, { headers: { Accept: "application/vnd.api+json" }, cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { attributes?: GleifAttrs } };
    return j.data?.attributes ? mapGleif(j.data.attributes) : null;
  } catch {
    return null;
  }
}

// ── GLEIF: wyszukanie po nazwie (pierwsze trafienie) ──
export async function gleifByName(name: string): Promise<GleifRecord | null> {
  try {
    const r = await fetch(`${GLEIF}?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=1`, {
      headers: { Accept: "application/vnd.api+json" }, cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { attributes?: GleifAttrs }[] };
    const a = j.data?.[0]?.attributes;
    return a ? mapGleif(a) : null;
  } catch {
    return null;
  }
}

type GleifAttrs = {
  lei?: string;
  entity?: {
    legalName?: { name?: string };
    legalAddress?: { addressLines?: string[]; city?: string; country?: string };
    jurisdiction?: string;
    status?: string;
    registeredAs?: string;
  };
  registration?: { status?: string };
};
function mapGleif(a: GleifAttrs): GleifRecord {
  const e = a.entity ?? {};
  const addr = e.legalAddress ?? {};
  return {
    lei: a.lei ?? "",
    name: e.legalName?.name ?? "",
    status: a.registration?.status ?? e.status ?? "",
    jurisdiction: e.jurisdiction ?? addr.country ?? "",
    address: [addr.addressLines?.join(" "), addr.city, addr.country].filter(Boolean).join(", "),
    registeredAs: e.registeredAs ?? undefined,
  };
}

// Wyłuskuje kody LEI (20 znaków alfanum.) z tekstu akt (postanowienie, tabele).
export function extractLeis(text: string): string[] {
  const m = text.match(/\b[A-Z0-9]{18}[0-9]{2}\b/g) ?? [];
  return [...new Set(m)];
}
