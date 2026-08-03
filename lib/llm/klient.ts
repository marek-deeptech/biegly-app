/**
 * Klient LLM z pomiarem zużycia — jedno wejście do API dla całej aplikacji.
 *
 * CO TO ROZWIĄZUJE: rachunek za API rósł szybciej niż intuicja podpowiadała, a w
 * kodzie nie było ANI JEDNEGO miejsca, które zapisywałoby, ile kosztowało wywołanie.
 * Pytanie „który krok pali budżet" nie miało jak dostać odpowiedzi — pozostawało
 * zgadywanie. Ten moduł zapisuje każde wywołanie: etykietę, sprawę, model, tokeny
 * i kwotę. Dopiero mając te dane wolno decydować, gdzie zejść z modelu albo z wejścia.
 *
 * DLACZEGO OPAKOWUJE KLIENTA, A NIE WYWOŁANIE: miejsc wywołania jest 22 i każde ma
 * własną obsługę odpowiedzi (`stop_reason === "max_tokens"`, filtrowanie bloków
 * tekstowych, własne limity). Nowa sygnatura wymusiłaby przepisanie ich wszystkich,
 * a każde przepisanie to okazja do zgubienia obsługi urwanej odpowiedzi. Podmiana
 * `messages.create` zostawia te miejsca nietknięte — zmiana to jedna linia importu.
 *
 * ⚠️ LOGOWANIE JEST FAIL-SOFT. Awaria zapisu logu NIE MOŻE przerwać generowania
 * opinii. Każdy zapis siedzi we własnym try/catch, a nieudany zapis do bazy wyłącza
 * dalsze próby na czas życia procesu, zamiast dokładać sekundę do każdego wywołania.
 *
 * ⚠️ CACHE JEST DOMYŚLNIE WYŁĄCZONY i włącza się go tylko w skryptach. W trasach
 * aplikacji biegły klika „generuj", żeby dostać NOWY tekst — odesłanie zapamiętanej
 * odpowiedzi wyglądałoby jak zignorowany klik.
 *
 * BLIŹNIACZE W PYTHONIE: scripts/llm.py.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { koszt } from "./cennik";

export type OpcjeKlienta = {
  /** case_id — najcenniejszy wymiar raportu: pokazuje koszt per sprawa. */
  sprawa?: string | null;
  /** Cache odpowiedzi na dysku. Tylko skrypty offline — patrz ostrzeżenie wyżej. */
  cache?: boolean;
  /** Nadpisanie klucza; domyślnie z ANTHROPIC_API_KEY. */
  apiKey?: string;
};

/** Jeden wpis logu — kształt wspólny dla JSONL, konsoli i tabeli llm_uzycie. */
export type WpisZuzycia = {
  czas: string;
  etykieta: string;
  sprawa: string | null;
  model: string;
  wejscie: number;
  wyjscie: number;
  cache_zapis: number;
  cache_odczyt: number;
  /** null = model spoza cennika. Widoczna luka jest lepsza niż zmyślona kwota. */
  usd: number | null;
  ms: number;
  /** "api" = zapłacone wywołanie, "cache" = odpowiedź z dysku (koszt 0). */
  zrodlo: "api" | "cache";
  stop_reason: string | null;
};

const KATALOG_CACHE = () =>
  process.env.BIEGLY_LLM_CACHE ?? path.join(os.tmpdir(), "biegly-llm-cache");

const PLIK_LOGU = () =>
  process.env.BIEGLY_LLM_LOG ?? path.join(os.homedir(), ".biegly-llm", "uzycie.jsonl");

/** Po pierwszej nieudanej próbie zapisu do bazy przestajemy dokładać opóźnienie. */
let bazaWylaczona = false;

/** Kanoniczny JSON — klucze posortowane, żeby ten sam prompt dawał ten sam odcisk. */
function kanoniczny(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(kanoniczny).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${kanoniczny(o[k])}`).join(",")}}`;
}

function kluczCache(params: unknown): string | null {
  try {
    const { ...bez } = params as Record<string, unknown>;
    delete bez.stream;
    return createHash("sha256").update(kanoniczny(bez)).digest("hex");
  } catch {
    return null;
  }
}

function zCache(klucz: string): Anthropic.Message | null {
  try {
    const p = path.join(KATALOG_CACHE(), `${klucz}.json`);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Anthropic.Message) : null;
  } catch {
    return null;
  }
}

function doCache(klucz: string, msg: Anthropic.Message): void {
  try {
    const kat = KATALOG_CACHE();
    fs.mkdirSync(kat, { recursive: true });
    fs.writeFileSync(path.join(kat, `${klucz}.json`), JSON.stringify(msg), "utf8");
  } catch {
    // Cache to optymalizacja. Brak zapisu = następnym razem zapłacimy jeszcze raz,
    // co jest kosztem, a nie błędem — nie ma czego zgłaszać wyżej.
  }
}

function doJsonl(w: WpisZuzycia): void {
  try {
    const p = PLIK_LOGU();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${JSON.stringify(w)}\n`, "utf8");
  } catch {
    // Na Vercelu system plików jest tylko do odczytu — zostaje konsola i baza.
  }
}

async function doBazy(w: WpisZuzycia): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (bazaWylaczona || !url || !key) return;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/llm_uzycie`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(w),
      // Zadławienie Supabase nie ma prawa zawiesić generowania opinii.
      signal: AbortSignal.timeout(3000),
    });
    // Najczęstsza przyczyna: migracja 0018 jeszcze niewgrana. Wyłączamy próby,
    // zamiast dokładać nieudany request do każdego kolejnego wywołania.
    if (!r.ok) bazaWylaczona = true;
  } catch {
    bazaWylaczona = true;
  }
}

async function zapisz(w: WpisZuzycia): Promise<void> {
  const kwota = w.usd === null ? "?" : `$${w.usd.toFixed(4)}`;
  const znacznik = w.zrodlo === "cache" ? " [z cache]" : "";
  console.log(
    `[llm] ${w.etykieta} ${w.model} we=${w.wejscie} wy=${w.wyjscie} ` +
      `${kwota} ${(w.ms / 1000).toFixed(1)}s${znacznik}`,
  );
  doJsonl(w);
  await doBazy(w);
}

/**
 * Klient Anthropic, który zapisuje każde wywołanie.
 *
 * `etykieta` musi być STABILNA między uruchomieniami — to po niej grupuje raport
 * kosztów. „redakcja/proza-bank" jest użyteczne, „krok 3" po miesiącu już nie.
 */
export function klientLLM(etykieta: string, opcje: OpcjeKlienta = {}): Anthropic {
  const ai = new Anthropic(opcje.apiKey ? { apiKey: opcje.apiKey } : {});
  const oryginalne = ai.messages.create.bind(ai.messages);

  ai.messages.create = (async (params: Anthropic.MessageCreateParams, ...reszta: unknown[]) => {
    // Strumieniowanie ma inny kształt odpowiedzi (zużycie przychodzi w zdarzeniach),
    // więc przepuszczamy je bez dotykania. Dziś nie strumieniuje żadne wywołanie.
    if ((params as { stream?: boolean }).stream)
      return (oryginalne as (...a: unknown[]) => unknown)(params, ...reszta);

    const model = String(params.model ?? "?");
    const klucz = opcje.cache ? kluczCache(params) : null;

    if (klucz) {
      const zapamietane = zCache(klucz);
      if (zapamietane) {
        await zapisz({
          czas: new Date().toISOString(),
          etykieta, sprawa: opcje.sprawa ?? null, model,
          wejscie: 0, wyjscie: 0, cache_zapis: 0, cache_odczyt: 0,
          usd: 0, ms: 0, zrodlo: "cache",
          stop_reason: zapamietane.stop_reason ?? null,
        });
        return zapamietane;
      }
    }

    const start = Date.now();
    const msg = (await (oryginalne as (...a: unknown[]) => unknown)(
      params,
      ...reszta,
    )) as Anthropic.Message;

    // Pomiar nie ma prawa zepsuć odpowiedzi, którą już zapłaciliśmy.
    try {
      const u = msg.usage ?? {};
      await zapisz({
        czas: new Date().toISOString(),
        etykieta,
        sprawa: opcje.sprawa ?? null,
        model,
        wejscie: u.input_tokens ?? 0,
        wyjscie: u.output_tokens ?? 0,
        cache_zapis: u.cache_creation_input_tokens ?? 0,
        cache_odczyt: u.cache_read_input_tokens ?? 0,
        usd: koszt(model, u),
        ms: Date.now() - start,
        zrodlo: "api",
        stop_reason: msg.stop_reason ?? null,
      });
    } catch {
      // celowo puste — patrz ostrzeżenie o fail-soft w nagłówku
    }

    // Urwanej odpowiedzi NIE zapamiętujemy: wywołanie ponowione po podniesieniu
    // max_tokens dostałoby z cache'u ten sam ucięty tekst i limit nic by nie dał.
    if (klucz && msg.stop_reason !== "max_tokens") doCache(klucz, msg);
    return msg;
  }) as typeof ai.messages.create;

  return ai;
}
