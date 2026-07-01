import { createClient } from "@/lib/supabase/server";

// Odpytanie oficjalnego API KRS (bez klucza). Zwraca dane spółki (jawne) oraz
// skład organów (dane osobowe są ZAMASKOWANE w rejestrze publicznym — pełne dane
// tylko w odpisie z akt sądowych). Źródło jest cytowane w odpowiedzi.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const krs = (new URL(req.url).searchParams.get("krs") || "").replace(/\D/g, "");
  if (krs.length !== 10)
    return Response.json({ ok: false, reason: "Podaj 10-cyfrowy numer KRS." }, { status: 400 });

  let d = await fetchReg(krs, "P");
  if (!pick(d, "odpis")) d = await fetchReg(krs, "S");
  if (!pick(d, "odpis")) return Response.json({ ok: false, reason: "Nie znaleziono podmiotu w KRS." }, { status: 404 });

  const a = pick(d, "odpis", "dane", "dzial1", "siedzibaIAdres", "adres");
  const adres = [pick(a, "ulica"), pick(a, "nrDomu"), pick(a, "nrLokalu"), pick(a, "kodPocztowy"), pick(a, "miejscowosc")]
    .map(str)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const persons: { funkcja: string; osoba: string }[] = [];
  const addSklad = (grupaKey: string, label: string) => {
    const sklad = pick(d, "odpis", "dane", "dzial2", grupaKey, "sklad");
    if (Array.isArray(sklad))
      for (const p of sklad) {
        const naz = str(pick(p, "nazwisko", "nazwiskoICzlon") ?? pick(p, "nazwisko", "nazwisko"));
        const im = str(pick(p, "imiona", "imie") ?? pick(p, "imie"));
        const osoba = `${im} ${naz}`.trim();
        if (osoba) persons.push({ funkcja: str(pick(p, "funkcja")) || label, osoba });
      }
  };
  addSklad("reprezentacja", "reprezentacja");
  addSklad("organNadzoru", "organ nadzoru");
  addSklad("prokurenci", "prokurent");

  const stan = str(pick(d, "odpis", "naglowekA", "stanZDnia"));
  return Response.json({
    ok: true,
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
  });
}
