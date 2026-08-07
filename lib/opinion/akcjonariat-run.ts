/**
 * Bieg kroku „Historia zmian w akcjonariacie" — wspólny dla trasy HTTP i skryptów.
 *
 * Dwa wejścia, bo źródła są różnej natury:
 *  • `wykonajBankier` — tabela HTML, czytana deterministycznie (bez modelu);
 *  • `wykonajSprawozdania` — proza sprawozdania, czytana modelem, ale model
 *    WYŁĄCZNIE przepisuje wielkości z dokumentu (patrz komentarz przy SYSTEM).
 *
 * Kwalifikacja zdarzeń i zestawienie źródeł zawsze w kodzie: lib/opinion/akcjonariat.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { klientLLM } from "@/lib/llm/klient";
import { pdfText } from "@/lib/intake/pdf";
import {
  dawneNazwy,
  kwalifikuj,
  parsujEmisjeBankier,
  parsujHistorieBankier,
  porownajZeSprawozdaniem,
  tabelaDni,
  tabelaEmisji,
  tabelaHistorii,
  tabelaRozbieznosci,
  toSamaSpolka,
  uwagiZrodel,
  type Emisja,
  type Tabela,
  type ZmianaAkcjonariatu,
} from "@/lib/opinion/akcjonariat";

export type Wynik = { ok: boolean; powod?: string; podsumowanie?: string };

export const URL_BANKIER = (ticker: string) =>
  `https://www.bankier.pl/gielda/notowania/akcje/${encodeURIComponent(ticker.toUpperCase())}/akcjonariat`;

/** Cała historia jest w statycznym HTML — „Pokaż więcej danych" tylko odsłania wiersze. */
export async function pobierzStroneBankiera(ticker: string): Promise<string> {
  const r = await fetch(URL_BANKIER(ticker), {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
  });
  if (!r.ok) throw new Error(`Bankier.pl zwrócił ${r.status} dla symbolu „${ticker}” — sprawdź symbol spółki`);
  return r.text();
}

/** Krok główny: historia z serwisu + zestawienie ze sprawozdaniami, jeśli już odczytane. */
export async function wykonajBankier(
  sb: SupabaseClient,
  caseId: string,
  cfg: { html?: string; ticker?: string; emitent?: string; url?: string },
): Promise<Wynik> {
  const html = cfg.html ?? (cfg.ticker ? await pobierzStroneBankiera(cfg.ticker) : null);
  if (!html) return { ok: false, powod: "podaj symbol spółki w serwisie Bankier.pl albo zapisaną stronę" };

  const historia = parsujHistorieBankier(html);
  const emisje = parsujEmisjeBankier(html);
  if (!historia.length)
    return {
      ok: false,
      powod:
        "nie znaleziono tabeli „Historia zmian w akcjonariacie” — sprawdź symbol spółki; " +
        "jeśli tabela jest na stronie, serwis zmienił jej układ i parser wymaga poprawki",
    };

  const { data: subs } = await sb.from("subanalyses").select("kind,data").eq("case_id", caseId);
  const zeSprawozdan = (((subs ?? []).find((s) => s.kind === "akcjonariat_sprawozdania")?.data as
    | { zmiany?: ZmianaAkcjonariatu[] }
    | null)?.zmiany ?? []) as ZmianaAkcjonariatu[];

  const zdarzenia = kwalifikuj([...historia, ...zeSprawozdan], emisje);
  const rozbieznosci = porownajZeSprawozdaniem(historia, zeSprawozdan);
  const tables = [
    tabelaHistorii(zdarzenia, cfg.emitent || undefined),
    tabelaDni(zdarzenia),
    tabelaEmisji(emisje),
    tabelaRozbieznosci(rozbieznosci),
  ].filter((t): t is Tabela => !!t);

  const dni = [...new Set(zdarzenia.filter((z) => z.kwalifikacja !== "bez zmiany").map((z) => z.data))].sort();
  const ile = (k: string) => zdarzenia.filter((z) => z.kwalifikacja === k).length;
  const findings = [
    `Odtworzono ${zdarzenia.length} zmian stanu posiadania w ${dni.length} dniach, w okresie ` +
      `${dni[0]} – ${dni[dni.length - 1]}; podmiotów w historii akcjonariatu: ` +
      `${new Set(zdarzenia.map((z) => z.akcjonariusz)).size}.`,
    `Kwalifikacja zdarzeń: nabycia ${ile("nabycie")}, zbycia ${ile("zbycie")}, objęcia nowych emisji ` +
      `${ile("objęcie emisji")}, rozwodnienia wskutek emisji ${ile("rozwodnienie")}, ` +
      `wymagających wyjaśnienia ${ile("nieokreślone")}.`,
    // Rozwodnienie MUSI paść wprost — w tabeli źródłowej wygląda identycznie jak zbycie.
    ...(ile("rozwodnienie")
      ? [
          `W ${ile("rozwodnienie")} przypadkach udział akcjonariusza spadł BEZ zbycia akcji: liczba akcji ` +
            "pozostała ta sama, a udział zmalał wskutek rejestracji nowej emisji. Zdarzeń tych nie wolno " +
            "czytać jako wyjścia z akcjonariatu.",
        ]
      : []),
    ...(rozbieznosci.length
      ? [
          "Stan wykazany w sprawozdaniach opisowych zarządu różni się od stanu wynikającego z serwisu " +
            `w ${rozbieznosci.length} przypadkach — zestawienie w tabeli rozbieżności.`,
        ]
      : []),
    ...uwagiZrodel(zdarzenia),
  ];

  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: caseId,
      kind: "akcjonariat",
      chapter_no: "IV",
      title: "Historia zmian w akcjonariacie",
      status: "szkic",
      body_md: "",
      data: {
        table: tables[0] ?? null,
        tables,
        findings,
        zdarzenia,
        emisje,
        rozbieznosci,
        emitent: cfg.emitent ?? null,
        ticker: cfg.ticker ?? null,
        zrodla: [
          `Bankier.pl — historia zmian w akcjonariacie i emisje kapitału (${cfg.url ?? (cfg.ticker ? URL_BANKIER(cfg.ticker) : "strona zapisana lokalnie")}, pobrano ${new Date().toISOString().slice(0, 10)})`,
          ...(zeSprawozdan.length ? ["Sprawozdania opisowe zarządu z działalności spółki (akta sprawy)"] : []),
        ],
      },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) return { ok: false, powod: `zapis: ${error.message}` };

  return {
    ok: true,
    podsumowanie:
      `Odtworzono ${zdarzenia.length} zmian w ${dni.length} dniach (${dni[0]} – ${dni[dni.length - 1]}): ` +
      `nabycia ${ile("nabycie")}, zbycia ${ile("zbycie")}, objęcia emisji ${ile("objęcie emisji")}, ` +
      `rozwodnienia ${ile("rozwodnienie")}` +
      (zeSprawozdan.length ? `; rozbieżności ze sprawozdaniami: ${rozbieznosci.length}` : "; bez danych ze sprawozdań zarządu"),
  };
}

// ── Sprawozdania opisowe zarządu ──────────────────────────────────────────

const SYSTEM =
  "Jesteś asystentem biegłego sądowego. Z tekstu sprawozdania zarządu wypisujesz WYŁĄCZNIE stan " +
  "akcjonariatu podany w dokumencie. ZASADY BEZWZGLĘDNE: (1) nie licz, nie sumuj, nie przeliczaj " +
  "procentów — przepisz wartości tak, jak stoją w tekście; (2) jeśli dokument nie podaje którejś " +
  "wielkości, wstaw null — NIE zgaduj; (3) `dzien` to dzień, NA KTÓRY podano stan (zwykle 31 grudnia " +
  "roku obrotowego), a nie data publikacji sprawozdania; (4) do każdej pozycji dołącz krótki cytat " +
  "z dokumentu. W polu `spolka` podaj nazwę spółki, KTÓREJ AKCJONARIAT opisuje ten fragment. " +
  'Zwróć wyłącznie JSON: {"spolka":"…"|null,"dzien":"RRRR-MM-DD"|null,"rok":RRRR|null,"pozycje":' +
  '[{"akcjonariusz":"…","akcje":liczba|null,"procentKapitalu":liczba|null,"glosy":liczba|null,' +
  '"procentGlosow":liczba|null,"cytat":"…"}]}. Bez stanu akcjonariatu zwróć pustą listę pozycji.';

type Poz = {
  akcjonariusz?: string;
  akcje?: number | null;
  procentKapitalu?: number | null;
  glosy?: number | null;
  procentGlosow?: number | null;
  cytat?: string;
};

export async function wykonajSprawozdania(
  sb: SupabaseClient,
  caseId: string,
  cfg: { emitent: string; maks?: number; log?: (s: string) => void },
): Promise<Wynik> {
  const log = cfg.log ?? (() => {});
  const maks = cfg.maks ?? 8;

  // Nazwy uznawane za tożsame: podane + DAWNE FIRMY emitenta z operacji kapitałowych.
  // Sprawozdanie jest podpisane firmą z dnia publikacji, więc bez tego własne
  // sprawozdania emitenta sprzed zmiany nazwy zostałyby odrzucone jako „obce".
  const { data: wczesniej } = await sb
    .from("subanalyses").select("data").eq("case_id", caseId).eq("kind", "akcjonariat").maybeSingle();
  const emisje = ((wczesniej?.data as { emisje?: Emisja[] } | null)?.emisje ?? []) as Emisja[];
  const nazwy = [...new Set([...cfg.emitent.split(",").map((x) => x.trim()).filter(Boolean), ...dawneNazwy(emisje)])];

  const { data: docs } = await sb
    .from("documents").select("rel_path,storage_path").eq("case_id", caseId).limit(3000);
  const kandydaci = (docs ?? [])
    .filter((d) => d.storage_path && /\.pdf$/i.test(d.rel_path) && !/\.pobrane|loader|cookie/i.test(d.rel_path))
    .filter((d) => /sprawozdan|zarzad|zarząd|dzialalnos|działalnoś|roczn/i.test(d.rel_path))
    .slice(0, 40);
  if (!kandydaci.length)
    return { ok: false, powod: "w aktach nie ma PDF-ów wyglądających na sprawozdania zarządu" };

  const zmiany: ZmianaAkcjonariatu[] = [];
  const zbadane: string[] = [];
  const bezTekstu: string[] = [];
  const obce: string[] = [];
  let uzyte = 0;

  for (const d of kandydaci) {
    if (uzyte >= maks) break;
    const nazwa = String(d.rel_path).split("/").pop() ?? "";
    const { data: blob } = await sb.storage.from("case-files").download(d.storage_path as string);
    if (!blob) continue;
    const tekst = await pdfText(await blob.arrayBuffer(), 60000);
    // Skan bez warstwy tekstowej idzie do OCR, nie do modelu. Cisza w tym miejscu
    // sugerowałaby, że dokument nie zawiera akcjonariatu — a on go nie oddał.
    if (tekst.replace(/\s/g, "").length < 400) {
      bezTekstu.push(nazwa);
      continue;
    }
    if (!/akcjonar|struktur\w* (własnoś|akcjonar)|stan posiadania|udział\w* w kapitale/i.test(tekst)) continue;
    zbadane.push(nazwa);
    uzyte += 1;

    const msg = await klientLLM("akcjonariat/sprawozdanie", { sprawa: caseId }).messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: `PLIK: ${nazwa}\n\nTREŚĆ:\n${tekst.slice(0, 55000)}` }],
    });
    const raw = (msg.content as Anthropic.ContentBlock[])
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text).join("\n").replace(/```json|```/g, "").trim();
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s < 0 || e <= s) {
      log(`✗ ${nazwa}: model nie zwrócił JSON`);
      continue;
    }
    const parsed = JSON.parse(raw.slice(s, e + 1)) as {
      spolka?: string | null; dzien?: string | null; rok?: number | null; pozycje?: Poz[];
    };
    const spolka = String(parsed.spolka ?? "");
    if (!toSamaSpolka(spolka, nazwy)) {
      obce.push(`${nazwa} → akcjonariat spółki „${spolka}”`);
      log(`⨯ ${nazwa}: akcjonariat spółki „${spolka}” — pomijam`);
      continue;
    }
    const dzien = parsed.dzien ?? (parsed.rok ? `${parsed.rok}-12-31` : null);
    if (!dzien || !parsed.pozycje?.length) {
      log(`• ${nazwa}: brak stanu akcjonariatu albo dnia, na który go podano`);
      continue;
    }
    for (const p of parsed.pozycje) {
      if (!p.akcjonariusz) continue;
      zmiany.push({
        data: dzien,
        akcjonariusz: String(p.akcjonariusz).trim(),
        akcje: p.akcje ?? null,
        akcjeZmiana: null, // dokument podaje STAN, nie zmianę — różnice liczy kod
        procent: p.procentKapitalu ?? null,
        procentZmiana: null,
        glosy: p.glosy ?? null,
        glosyZmiana: null,
        zrodlo: "sprawozdanie",
        plik: nazwa,
      });
    }
    log(`✓ ${nazwa}: stan na ${dzien}, pozycji ${parsed.pozycje.length}`);
  }

  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: caseId,
      kind: "akcjonariat_sprawozdania",
      chapter_no: "IV",
      title: "Akcjonariat wg sprawozdań opisowych zarządu (dane źródłowe)",
      status: "szkic",
      body_md: "",
      data: { zmiany, zbadane, bezTekstu, obce, emitent: cfg.emitent, nazwy },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) return { ok: false, powod: `zapis: ${error.message}` };

  return {
    ok: true,
    podsumowanie:
      `Odczytano ${zmiany.length} pozycji z ${zbadane.length} sprawozdań` +
      (obce.length ? `; pominięto ${obce.length} o innej spółce` : "") +
      (bezTekstu.length ? `; ${bezTekstu.length} skanów wymaga OCR` : "") +
      ". Uruchom teraz pobranie z Bankier.pl, żeby zestawić oba źródła.",
  };
}
