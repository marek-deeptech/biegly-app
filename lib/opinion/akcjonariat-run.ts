/**
 * Bieg kroku „Historia zmian w akcjonariacie" — wspólny dla trasy HTTP i skryptów.
 *
 * Trzy źródła różnej natury i różnej wagi dowodowej, plus złożenie:
 *  • `wykonajZawiadomienia` — zawiadomienia z art. 69 (ŹRÓDŁO PIERWOTNE), model
 *    czyta stan przed i po, RÓŻNICĘ liczy kod;
 *  • `wykonajSprawozdania` — stan na dzień bilansowy z prozy sprawozdania zarządu;
 *  • `wykonajBankier` — tabela HTML serwisu, czytana deterministycznie (bez modelu);
 *    dla spółek WYKLUCZONYCH Z OBROTU serwis nie prowadzi strony i to źródło odpada;
 *  • `zlozAkcjonariat` — rozdział z tego, co jest.
 *
 * Kwalifikacja zdarzeń i zestawienie źródeł zawsze w kodzie: lib/opinion/akcjonariat.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { ostatniJson } from "@/lib/llm/json";
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
  tabeleHistoriiWgEmitenta,
  emitenciZdarzen,
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

/**
 * Pobór z serwisu — zapisuje WYŁĄCZNIE dane źródłowe, po czym składa rozdział.
 * Rozdzielenie „źródło" od „złożenia" jest konieczne, bo dla spółki wykluczonej
 * z obrotu serwisu nie ma wcale, a rozdział i tak musi powstać z dokumentów.
 */
export async function wykonajBankier(
  sb: SupabaseClient,
  caseId: string,
  cfg: { html?: string; ticker?: string; emitent?: string; url?: string },
): Promise<Wynik> {
  const html = cfg.html ?? (cfg.ticker ? await pobierzStroneBankiera(cfg.ticker) : null);
  if (!html) return { ok: false, powod: "podaj symbol spółki w serwisie Bankier.pl albo zapisaną stronę" };

  const zmiany = parsujHistorieBankier(html);
  const emisje = parsujEmisjeBankier(html);
  if (!zmiany.length)
    return {
      ok: false,
      powod:
        "nie znaleziono tabeli „Historia zmian w akcjonariacie”. Serwis nie prowadzi strony spółek " +
        "WYKLUCZONYCH Z OBROTU — dla takiego emitenta historię trzeba złożyć z zawiadomień o stanie " +
        "posiadania i sprawozdań zarządu z akt. Jeśli spółka jest notowana, sprawdź symbol.",
    };

  const url = cfg.url ?? (cfg.ticker ? URL_BANKIER(cfg.ticker) : "strona zapisana lokalnie");
  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: caseId,
      kind: "akcjonariat_bankier",
      chapter_no: "IV",
      title: "Historia akcjonariatu wg Bankier.pl (dane źródłowe)",
      status: "szkic",
      body_md: "",
      data: { zmiany, emisje, url, ticker: cfg.ticker ?? null, pobrano: new Date().toISOString().slice(0, 10) },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) return { ok: false, powod: `zapis: ${error.message}` };
  return zlozAkcjonariat(sb, caseId, { emitent: cfg.emitent });
}

/**
 * Złożenie rozdziału z WSZYSTKICH dostępnych źródeł: serwisu (jeśli był),
 * zawiadomień o stanie posiadania i sprawozdań opisowych zarządu.
 */
export async function zlozAkcjonariat(
  sb: SupabaseClient,
  caseId: string,
  cfg: { emitent?: string },
): Promise<Wynik> {
  const { data: subs } = await sb.from("subanalyses").select("kind,data").eq("case_id", caseId);
  const zrodlo = (kind: string) => (subs ?? []).find((s) => s.kind === kind)?.data as
    | { zmiany?: ZmianaAkcjonariatu[]; emisje?: Emisja[]; url?: string; pobrano?: string }
    | undefined;
  const bank = zrodlo("akcjonariat_bankier");
  const zZawiadomien = (zrodlo("akcjonariat_zawiadomienia")?.zmiany ?? []) as ZmianaAkcjonariatu[];
  const zeSprawozdan = (zrodlo("akcjonariat_sprawozdania")?.zmiany ?? []) as ZmianaAkcjonariatu[];
  const zSerwisu = (bank?.zmiany ?? []) as ZmianaAkcjonariatu[];
  const emisje = (bank?.emisje ?? []) as Emisja[];

  const wszystkie = [...zSerwisu, ...zZawiadomien, ...zeSprawozdan];
  if (!wszystkie.length)
    return {
      ok: false,
      powod:
        "żadne ze źródeł nie dostarczyło danych: uruchom pobranie z Bankier.pl (spółka notowana) " +
        "albo odczyt zawiadomień o stanie posiadania i sprawozdań zarządu z akt",
    };

  const zdarzenia = kwalifikuj(wszystkie, emisje);
  // Stan ze sprawozdania porównujemy z ciągiem zdarzeń datowanych — obojętne,
  // czy pochodzą z serwisu, czy z zawiadomień.
  const podstawa = [...zSerwisu, ...zZawiadomien];
  const rozbieznosci = porownajZeSprawozdaniem(podstawa, zeSprawozdan);
  const tables = [
    ...tabeleHistoriiWgEmitenta(zdarzenia),
    tabelaDni(zdarzenia),
    tabelaEmisji(emisje),
    tabelaRozbieznosci(rozbieznosci),
  ].filter((t): t is Tabela => !!t);

  const dni = [...new Set(zdarzenia.filter((z) => z.kwalifikacja !== "bez zmiany").map((z) => z.data))].sort();
  const ile = (k: string) => zdarzenia.filter((z) => z.kwalifikacja === k).length;
  const wgZrodla = (z: ZmianaAkcjonariatu["zrodlo"]) => zdarzenia.filter((x) => x.zrodlo === z).length;
  const findings = [
    `Odtworzono ${zdarzenia.length} zmian stanu posiadania w ${dni.length} dniach, w okresie ` +
      `${dni[0]} – ${dni[dni.length - 1]}; podmiotów w historii akcjonariatu: ` +
      `${new Set(zdarzenia.map((z) => z.akcjonariusz)).size}.`,
    ...(emitenciZdarzen(zdarzenia).length > 1
      ? [
          `Zestawienie obejmuje akcje ${emitenciZdarzen(zdarzenia).length} emitentów ` +
            `(${emitenciZdarzen(zdarzenia).join(", ")}); historię każdego z nich przedstawiono w ODRĘBNEJ tabeli, ` +
            "ponieważ są to niezależne struktury właścicielskie, a ten sam podmiot bywa w jednej akcjonariuszem, " +
            "a w drugiej emitentem.",
        ]
      : []),
    `Źródła zdarzeń: zawiadomienia o stanie posiadania ${wgZrodla("zawiadomienie")}, wykazy akcjonariuszy ` +
      `z walnych zgromadzeń ${wgZrodla("wykaz_wza")}, serwis Bankier.pl ${wgZrodla("bankier")}, ` +
      `sprawozdania opisowe zarządu ${wgZrodla("sprawozdanie")}.`,
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
          "Stan wykazany w sprawozdaniach opisowych zarządu różni się od stanu wynikającego z pozostałych " +
            `źródeł w ${rozbieznosci.length} przypadkach — zestawienie w tabeli rozbieżności.`,
        ]
      : []),
    ...uwagiZrodel(zdarzenia),
  ];

  const zrodla = [
    ...(zSerwisu.length ? [`Bankier.pl — historia zmian w akcjonariacie i emisje kapitału (${bank?.url}, pobrano ${bank?.pobrano})`] : []),
    ...(zZawiadomien.length ? ["Zawiadomienia o stanie posiadania (art. 69 ustawy o ofercie publicznej) — akta sprawy"] : []),
    ...(zeSprawozdan.length ? ["Sprawozdania opisowe zarządu z działalności spółki — akta sprawy"] : []),
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
        tables, findings, zdarzenia, emisje, rozbieznosci,
        emitent: cfg.emitent ?? null,
        zrodla,
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
      (rozbieznosci.length ? `; rozbieżności ze sprawozdaniami: ${rozbieznosci.length}` : ""),
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
  // Nazwa PLIKU, nie ścieżka — patrz komentarz przy doborze zawiadomień.
  const nazwaPliku = (d: { rel_path: string }) => String(d.rel_path).split("/").pop() ?? "";
  const kandydaci = (docs ?? [])
    .filter((d) => d.storage_path && /\.pdf$/i.test(d.rel_path) && !/\.pobrane|loader|cookie/i.test(d.rel_path))
    .filter((d) => /sprawozdan|zarzad|zarząd|dzialalnos|działalnoś|roczn/i.test(nazwaPliku(d)))
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
    const parsed = ostatniJson<{ spolka?: string | null; dzien?: string | null; rok?: number | null; pozycje?: Poz[] }>(raw);
    if (!parsed) {
      log(`✗ ${nazwa}: model nie zwrócił poprawnego JSON`);
      continue;
    }
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
        emitentAkcji: spolka || null,
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

  const zlozone = zmiany.length ? await zlozAkcjonariat(sb, caseId, { emitent: cfg.emitent }) : null;
  return {
    ok: true,
    podsumowanie:
      `Odczytano ${zmiany.length} pozycji z ${zbadane.length} sprawozdań` +
      (obce.length ? `; pominięto ${obce.length} o innej spółce` : "") +
      (bezTekstu.length ? `; ${bezTekstu.length} skanów wymaga OCR` : "") +
      (zlozone?.ok ? `. ${zlozone.podsumowanie}` : ""),
  };
}

// ── Zawiadomienia o stanie posiadania (art. 69 ustawy o ofercie) ──────────
//
// ⚠️ ŹRÓDŁO PIERWOTNE I JEDYNE dla spółek WYKLUCZONYCH Z OBROTU. Bankier.pl nie
// prowadzi strony spółki po wykluczeniu (CSY, RSY i ZASTAL zwracają 303 → /#404),
// więc dla sprawy ZASTAL cała historia stanu posiadania musi powstać z dokumentów.
//
// Zawiadomienie podaje stan PRZED i PO zdarzeniu — różnicę liczy kod, nie model.

const SYSTEM_ZAW =
  "Jesteś asystentem biegłego sądowego. Z treści zawiadomienia o zmianie stanu posiadania akcji " +
  "(art. 69 ustawy o ofercie publicznej) wypisujesz WYŁĄCZNIE wielkości podane w dokumencie. " +
  "ZASADY BEZWZGLĘDNE: (1) nie licz różnic ani procentów — podaj stan PRZED i PO tak, jak stoi " +
  "w treści; (2) brak wielkości w dokumencie → null, nigdy domysł; (3) `data` to dzień ZDARZENIA " +
  "(transakcji, rejestracji), nie data pisma ani wpływu; (4) `akcjonariusz` to podmiot, którego stan " +
  "posiadania się zmienił, a `spolka` — emitent, którego akcji dotyczy zawiadomienie; (5) do każdej " +
  "pozycji dołącz krótki cytat. " +
  "(6) `podstawa` rozstrzyga naturę liczb: „art69” — zawiadomienie o zmianie stanu posiadania (podaje stan " +
  "przed i po); „art70pkt3” — wykaz akcjonariuszy z walnego zgromadzenia (podaje GŁOSY ZAREJESTROWANE na " +
  "zgromadzeniu i ich udział w ogólnej liczbie głosów, a NIE stan posiadania); „inne” — pozostałe. " +
  "Dla „art70pkt3” wpisz zarejestrowane głosy w `akcjePo`, a udział w ogólnej liczbie głosów w `procentPo`; " +
  "pól `akcjePrzed`/`procentPrzed` NIE wypełniaj. " +
  'Zwróć wyłącznie JSON: {"spolka":"…"|null,"podstawa":"art69"|"art70pkt3"|"inne","zdarzenia":' +
  '[{"data":"RRRR-MM-DD","akcjonariusz":"…","akcjePrzed":liczba|null,"akcjePo":liczba|null,' +
  '"procentPrzed":liczba|null,"procentPo":liczba|null,"cytat":"…"}]}. ' +
  "Gdy dokument nie mówi o stanie posiadania ani o wykazie akcjonariuszy, zwróć puste `zdarzenia`.";

type PozZaw = {
  data?: string;
  akcjonariusz?: string;
  akcjePrzed?: number | null;
  akcjePo?: number | null;
  procentPrzed?: number | null;
  procentPo?: number | null;
  cytat?: string;
};

export async function wykonajZawiadomienia(
  sb: SupabaseClient,
  caseId: string,
  cfg: { emitent: string; maks?: number; log?: (s: string) => void },
): Promise<Wynik> {
  const log = cfg.log ?? (() => {});
  const maks = cfg.maks ?? 20;

  const { data: wczesniej } = await sb
    .from("subanalyses").select("data").eq("case_id", caseId).eq("kind", "akcjonariat_bankier").maybeSingle();
  const emisje = ((wczesniej?.data as { emisje?: Emisja[] } | null)?.emisje ?? []) as Emisja[];
  const nazwy = [...new Set([...cfg.emitent.split(",").map((x) => x.trim()).filter(Boolean), ...dawneNazwy(emisje)])];

  const { data: docs } = await sb
    .from("documents").select("rel_path,storage_path,doc_type").eq("case_id", caseId).limit(3000);
  // Typ dokumentu ALBO nazwa pliku — zawiadomienia bywają sklasyfikowane jako
  // zwykłe raporty ESPI, a bywają nazwane wprost.
  // ⚠️ DOPASOWANIE PO NAZWIE PLIKU, NIE PO ŚCIEŻCE. Akta są ułożone w katalogi
  // („…/ZAWIADOMIENIE KNF/…”), więc wzorzec puszczony na całą ścieżkę wciągał
  // wszystko, co leży w takim katalogu — w sprawie ZASTAL 44 umowy maklerskie
  // zamiast zawiadomień. Typ dokumentu jest sygnałem pierwszym, nazwa drugim.
  const nazwaPliku = (d: { rel_path: string }) => String(d.rel_path).split("/").pop() ?? "";
  const wszystkie = (docs ?? [])
    // Raporty pozyskane z serwisu ESPI/EBI są tekstem, nie PDF-em — treść raportu
    // stoi w HTML węzła, bez załącznika. Odcięcie ich rozszerzeniem wyrzuciłoby
    // najlepsze dostępne źródło dla spółki wykluczonej z obrotu.
    .filter((d) => d.storage_path && /\.(pdf|txt)$/i.test(d.rel_path) && !/\.pobrane|loader|cookie/i.test(d.rel_path))
    .filter(
      (d) =>
        /ZAWIAD|ESPI|EBI/i.test(String(d.doc_type)) ||
        /zawiadomien|stan\w* posiadan|art\.?\s*69|zej[śs]ci\w* z prog|znaczn\w+ pakiet/i.test(nazwaPliku(d)),
    );
  // Ten sam dokument bywa w aktach kilka razy: jako skan i jako jego wersja po OCR
  // (`.ocr.pdf`), albo jako PDF z akt i tekst pobrany z serwisu. Klucz to numer węzła
  // ESPI z nazwy, a gdy go nie ma — nazwa bez rozszerzenia i bez sufiksu `.ocr`.
  // ⚠️ Z pary skan/OCR wybieramy WERSJĘ PO OCR: oryginał nie ma warstwy tekstowej,
  // więc wygrana oryginału oznaczałaby cichą utratę treści, którą właśnie odzyskaliśmy.
  const kluczDok = (d: { rel_path: string }) => {
    const n = nazwaPliku(d).toLowerCase();
    return (n.match(/node[_-]?(\d+)/i) ?? [])[1] ?? n.replace(/\.ocr\.pdf$/, "").replace(/\.(pdf|txt)$/, "");
  };
  const najlepsze = new Map<string, (typeof wszystkie)[number]>();
  for (const d of wszystkie) {
    const k = kluczDok(d);
    const stary = najlepsze.get(k);
    const poOcr = (x: { rel_path: string }) => /\.ocr\.pdf$/i.test(nazwaPliku(x));
    if (!stary || (poOcr(d) && !poOcr(stary))) najlepsze.set(k, d);
  }
  const bezPowtorzen = [...najlepsze.values()];
  const kandydaci = bezPowtorzen.slice(0, 60);
  const pominietoNadLimit = bezPowtorzen.length - kandydaci.length;
  const powtorzenia = wszystkie.length - bezPowtorzen.length;
  if (!kandydaci.length)
    return { ok: false, powod: "w aktach nie ma dokumentów wyglądających na zawiadomienia o stanie posiadania" };

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
    const tekst = /\.txt$/i.test(nazwa) ? (await blob.text()).slice(0, 30000) : await pdfText(await blob.arrayBuffer(), 30000);
    if (tekst.replace(/\s/g, "").length < 200) {
      bezTekstu.push(nazwa);
      continue;
    }
    // ⚠️ BRAMKA MUSI ZNAĆ OBIE PODSTAWY. Pierwsza wersja szukała tylko słów
    // z zawiadomień art. 69 i cicho odrzucała wykazy akcjonariuszy z WZA
    // (art. 70 pkt 3) — czyli jedyne dostępne punkty stanu posiadania dla spółki
    // wykluczonej z obrotu.
    if (
      !/stan\w* posiadan|art\.?\s*69|znaczn\w+ pakiet|prog\w* (ogólnej liczby głosów|[0-9])/i.test(tekst) &&
      !/wykaz\w* akcjonariuszy|art\.?\s*70 pkt 3|liczb\w* głosów na (ZWZ|NWZ|WZA)|powyżej 5\s*%/i.test(tekst)
    )
      continue;
    zbadane.push(nazwa);
    uzyte += 1;

    const msg = await klientLLM("akcjonariat/zawiadomienie", { sprawa: caseId }).messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      system: SYSTEM_ZAW,
      messages: [{ role: "user", content: `PLIK: ${nazwa}\n\nTREŚĆ:\n${tekst.slice(0, 28000)}` }],
    });
    const raw = (msg.content as Anthropic.ContentBlock[])
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text).join("\n").replace(/```json|```/g, "").trim();
    const parsed = ostatniJson<{ spolka?: string | null; podstawa?: string; zdarzenia?: PozZaw[] }>(raw);
    if (!parsed) {
      log(`✗ ${nazwa}: model nie zwrócił poprawnego JSON`);
      continue;
    }
    const spolka = String(parsed.spolka ?? "");
    if (!toSamaSpolka(spolka, nazwy)) {
      obce.push(`${nazwa} → akcje spółki „${spolka}”`);
      log(`⨯ ${nazwa}: zawiadomienie dotyczy akcji „${spolka}” — pomijam`);
      continue;
    }
    let dodane = 0;
    for (const z of parsed.zdarzenia ?? []) {
      if (!z.akcjonariusz || !z.data || !/^\d{4}-\d{2}-\d{2}$/.test(String(z.data))) continue;
      // RÓŻNICĘ LICZY KOD. Model podaje stan przed i po — to jest jego rola.
      const zmianaAkcji = z.akcjePrzed != null && z.akcjePo != null ? z.akcjePo - z.akcjePrzed : null;
      const zmianaProc =
        z.procentPrzed != null && z.procentPo != null ? Math.round((z.procentPo - z.procentPrzed) * 100) / 100 : null;
      const wykaz = String(parsed.podstawa ?? "").includes("70");
      zmiany.push({
        data: String(z.data),
        akcjonariusz: String(z.akcjonariusz).trim(),
        akcje: z.akcjePo ?? null,
        akcjeZmiana: wykaz ? null : zmianaAkcji,
        procent: z.procentPo ?? null,
        procentZmiana: wykaz ? null : zmianaProc,
        glosy: null,
        glosyZmiana: null,
        zrodlo: wykaz ? "wykaz_wza" : "zawiadomienie",
        plik: nazwa,
        emitentAkcji: spolka || null,
      });
      dodane += 1;
    }
    if (dodane)
      log(`✓ ${nazwa}: ${dodane} ${String(parsed.podstawa ?? "").includes("70") ? "pozycji wykazu z WZA" : "zdarzeń stanu posiadania"}`);
  }

  const { error } = await sb.from("subanalyses").upsert(
    {
      case_id: caseId,
      kind: "akcjonariat_zawiadomienia",
      chapter_no: "IV",
      title: "Zawiadomienia o stanie posiadania (dane źródłowe)",
      status: "szkic",
      body_md: "",
      data: { zmiany, zbadane, bezTekstu, obce, emitent: cfg.emitent, nazwy, pominietoNadLimit, powtorzenia },
    },
    { onConflict: "case_id,kind" },
  );
  if (error) return { ok: false, powod: `zapis: ${error.message}` };

  const zlozone = zmiany.length ? await zlozAkcjonariat(sb, caseId, { emitent: cfg.emitent }) : null;
  return {
    ok: true,
    podsumowanie:
      `Odczytano ${zmiany.length} zdarzeń z ${zbadane.length} zawiadomień` +
      // Odsiew ponad limit musi być powiedziany — inaczej „tyle jest” brzmi jak „tyle było”.
      (powtorzenia > 0 ? `; pominięto ${powtorzenia} kopii tych samych raportów` : "") +
      (pominietoNadLimit > 0 ? `; ${pominietoNadLimit} kandydatów poza limitem biegu` : "") +
      (obce.length ? `; pominięto ${obce.length} dotyczących akcji innej spółki` : "") +
      (bezTekstu.length ? `; ${bezTekstu.length} skanów wymaga OCR` : "") +
      (zlozone?.ok ? `. ${zlozone.podsumowanie}` : ""),
  };
}
