/**
 * Wrapper klienta LLM — zachowania, które przy fail-soft psują się po cichu.
 *
 * Wrapper ma jedną twardą obietnicę: NIE ZMIENIA odpowiedzi i NIE PRZERYWA
 * wywołania. Awaria logu nie może wywalić generowania opinii, a cache nie może
 * podmienić treści. Oba błędy byłyby niewidoczne w normalnym użyciu — pierwszy
 * ujawniłby się dopiero jako wywalona redakcja rozdziału w środku pracy biegłego,
 * drugi jako „to nie jest tekst, który przed chwilą wygenerowałeś".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Ile razy atrapa SDK naprawdę poszła „do API". */
let wywolanIle = 0;
let nastepnaOdpowiedz: Record<string, unknown>;

vi.mock("@anthropic-ai/sdk", () => {
  class AtrapaAnthropic {
    messages = {
      create: async () => {
        wywolanIle += 1;
        return nastepnaOdpowiedz;
      },
    };
  }
  return { default: AtrapaAnthropic };
});

const { klientLLM } = await import("@/lib/llm/klient");

const ODPOWIEDZ = (nadpisz: Record<string, unknown> = {}) => ({
  id: "msg_1",
  content: [{ type: "text", text: "treść odpowiedzi" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 150_000, output_tokens: 48_000 },
  ...nadpisz,
});

const PARAMS = {
  model: "claude-opus-4-8",
  max_tokens: 4000,
  system: "systemowy",
  messages: [{ role: "user" as const, content: "pytanie" }],
};

let katalog: string;
let plikLogu: string;

beforeEach(() => {
  wywolanIle = 0;
  nastepnaOdpowiedz = ODPOWIEDZ();
  katalog = fs.mkdtempSync(path.join(os.tmpdir(), "llm-test-"));
  plikLogu = path.join(katalog, "uzycie.jsonl");
  process.env.BIEGLY_LLM_CACHE = path.join(katalog, "cache");
  process.env.BIEGLY_LLM_LOG = plikLogu;
  // Bez tych zmiennych wrapper nie próbuje pisać do bazy — testy nie ruszają sieci.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(katalog, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const wpisy = () =>
  fs.existsSync(plikLogu)
    ? fs.readFileSync(plikLogu, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

describe("przezroczystość", () => {
  it("zwraca odpowiedź modelu nietkniętą", async () => {
    const ai = klientLLM("test");
    const msg = await ai.messages.create(PARAMS);
    // Miejsca wywołania czytają dokładnie te pola — każda podmiana byłaby regresją.
    expect(msg).toEqual(ODPOWIEDZ());
    expect(msg.stop_reason).toBe("end_turn");
    expect(msg.content[0]).toEqual({ type: "text", text: "treść odpowiedzi" });
  });
});

describe("log zużycia", () => {
  it("zapisuje tokeny, kwotę i etykietę", async () => {
    const ai = klientLLM("redakcja/proza-bank", { sprawa: "case-123" });
    await ai.messages.create(PARAMS);

    const [w] = wpisy();
    expect(w.etykieta).toBe("redakcja/proza-bank");
    expect(w.sprawa).toBe("case-123");
    expect(w.model).toBe("claude-opus-4-8");
    expect(w.wejscie).toBe(150_000);
    expect(w.wyjscie).toBe(48_000);
    expect(w.zrodlo).toBe("api");
    expect(w.usd).toBeCloseTo(1.95, 6); // 150k×$5 + 48k×$25 wg cennika
  });

  it("odnotowuje urwaną odpowiedź", async () => {
    // stop_reason w logu pozwala wychwycić rozdziały ucięte limitem — płacimy
    // za nie pełną stawkę, a tekst jest nie do użycia.
    nastepnaOdpowiedz = ODPOWIEDZ({ stop_reason: "max_tokens" });
    await klientLLM("test").messages.create(PARAMS);
    expect(wpisy()[0].stop_reason).toBe("max_tokens");
  });

  it("niezapisywalny log nie przerywa wywołania", async () => {
    // Vercel ma system plików tylko do odczytu. Gdyby to wywalało, każda redakcja
    // rozdziału padałaby na produkcji, a lokalnie działała.
    process.env.BIEGLY_LLM_LOG = "/proc/nie-ma-takiego-katalogu/uzycie.jsonl";
    const msg = await klientLLM("test").messages.create(PARAMS);
    expect(msg.stop_reason).toBe("end_turn");
    expect(wywolanIle).toBe(1);
  });

  it("model spoza cennika daje usd=null, nie zero", async () => {
    await klientLLM("test").messages.create({ ...PARAMS, model: "claude-nieznany-1" });
    expect(wpisy()[0].usd).toBeNull();
  });
});

describe("cache", () => {
  it("domyślnie WYŁĄCZONY — trasy aplikacji zawsze generują na nowo", async () => {
    const ai = klientLLM("test");
    await ai.messages.create(PARAMS);
    await ai.messages.create(PARAMS);
    expect(wywolanIle).toBe(2);
  });

  it("włączony oszczędza drugie wywołanie i oddaje tę samą treść", async () => {
    const ai = klientLLM("skrypt", { cache: true });
    const a = await ai.messages.create(PARAMS);
    const b = await ai.messages.create(PARAMS);
    expect(wywolanIle).toBe(1);
    expect(b).toEqual(a);
    expect(wpisy().map((w) => w.zrodlo)).toEqual(["api", "cache"]);
    expect(wpisy()[1].usd).toBe(0);
  });

  it("różny prompt = różny klucz", async () => {
    const ai = klientLLM("skrypt", { cache: true });
    await ai.messages.create(PARAMS);
    await ai.messages.create({ ...PARAMS, messages: [{ role: "user", content: "inne pytanie" }] });
    expect(wywolanIle).toBe(2);
  });

  it("kolejność kluczy w parametrach nie zmienia klucza cache'u", async () => {
    const ai = klientLLM("skrypt", { cache: true });
    await ai.messages.create(PARAMS);
    await ai.messages.create({
      messages: PARAMS.messages, system: PARAMS.system,
      max_tokens: PARAMS.max_tokens, model: PARAMS.model,
    });
    expect(wywolanIle).toBe(1);
  });

  it("NIE zapamiętuje urwanej odpowiedzi", async () => {
    // Inaczej ponowienie po podniesieniu max_tokens dostałoby z dysku ten sam
    // ucięty tekst i limit nic by nie zmienił — usterka nie do zdiagnozowania.
    nastepnaOdpowiedz = ODPOWIEDZ({ stop_reason: "max_tokens" });
    const ai = klientLLM("skrypt", { cache: true });
    await ai.messages.create(PARAMS);
    await ai.messages.create(PARAMS);
    expect(wywolanIle).toBe(2);
  });
});
