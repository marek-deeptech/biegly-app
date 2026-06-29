// Deterministyczny montaż opinii z subanaliz.
//
// Zasada: LLM NIE LICZY. Wszystkie liczby pochodzą z silnika faktów (tabela
// `metrics`); proza jest szablonowa. Opinia montuje się z ZATWIERDZONYCH
// subanaliz (tabela `subanalyses`); rozdział bez zapisanej subanalizy pokazuje
// podgląd „na żywo" oznaczony jako szkic.

export type Conf = "grounded" | "review" | "todo";
export type Para = { text: string; conf: Conf };
export type OpTable = { caption: string; head: string[]; rows: string[][] };
export type Chapter = {
  no: string;
  title: string;
  status: "ready" | "draft" | "todo";
  source?: string;
  paras: Para[];
  table?: OpTable;
  findings?: Para[];
  attachments?: string[];
};
export type Opinion = {
  caseName: string;
  signature: string | null;
  expert: string;
  generatedAt: string;
  legalBasis: string[];
  chapters: Chapter[];
};

// Wynik generatora subanalizy (do zapisania w `subanalyses`).
export type SubResult = {
  kind: string;
  chapterNo: string;
  title: string;
  bodyMd: string;
  data: { table: OpTable | null; findings: string[]; legalRefs: string[] };
};
export type QuantResult = SubResult;

// Zapisana subanaliza (z tabeli `subanalyses`).
export type StoredSub = {
  kind: string;
  chapter_no: string;
  title: string;
  status: string; // 'szkic' | 'zatwierdzona'
  body_md: string;
  data: { table?: OpTable | null; findings?: string[]; legalRefs?: string[] } | null;
};

type Metric = {
  key: string;
  value: number | null;
  unit: string | null;
  session_day: string | null;
};
type Doc = { rel_path: string; provenance: string | null; doc_type?: string | null };

const EXPERT = "mgr Krzysztof Michrowski — biegły sądowy";
const LEGAL_BASIS = [
  "art. 12 rozporządzenia MAR (UE) 596/2014 — definicja manipulacji na rynku",
  "rozporządzenie delegowane (UE) 2016/522, załącznik II — wskaźniki manipulacji",
  "art. 183 ustawy z dnia 29 lipca 2005 r. o obrocie instrumentami finansowymi",
];

function plnum(n: number | null | undefined, unit?: string | null): string {
  if (n == null) return "—";
  const s = n.toLocaleString("pl-PL");
  if (unit === "%") return `${s}%`;
  return unit ? `${s} ${unit}` : s;
}
function basename(p: string): string {
  return p.split("/").pop() || p;
}
function splitParas(md: string): string[] {
  return md.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
}

// ── Generator subanalizy ilościowej — deterministyczny, z metryk silnika ──
export function buildQuantitativeSubanaliza(metrics: Metric[]): QuantResult | null {
  if (!metrics.length) return null;
  const find = (k: string) => metrics.find((m) => m.key === k) ?? null;
  const peak = (prefix: string) =>
    metrics
      .filter((m) => m.key.startsWith(prefix))
      .reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
  const days = [
    ...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day as string)),
  ].sort();

  const groupShare = find("group_turnover_share");
  const nTx = find("totals_transactions");
  const valTx = find("totals_value");
  const volTx = find("totals_volume");
  const washPeak = peak("wash_");
  const cancelPeak = peak("cancel_");

  const paras: string[] = [
    `Na podstawie danych transakcyjnych z systemu UTP (udostępnionych przez Giełdę Papierów ` +
      `Wartościowych w Warszawie) przeanalizowano ${plnum(nTx?.value)} transakcji o łącznej ` +
      `wartości ${plnum(valTx?.value, "zł")} i wolumenie ${plnum(volTx?.value, "szt")}. ` +
      `Udział rachunków powiązanych (dalej „Grupa") w wartości obrotu instrumentem wyniósł ` +
      `${plnum(groupShare?.value, "%")}.`,
  ];
  if (washPeak) {
    paras.push(
      `W analizowanych sesjach stwierdzono transakcje wzajemne (wash trades), w których po obu ` +
        `stronach występowały rachunki Grupy. Udział takich transakcji w wolumenie sesji sięgał ` +
        `${plnum(washPeak.value, "%")} (sesja ${washPeak.session_day}). Transakcje te nie powodują ` +
        `zmiany rzeczywistego właściciela ekonomicznego instrumentu i stanowią pozorny obrót w ` +
        `rozumieniu art. 12 ust. 1 lit. a MAR oraz załącznika II do rozporządzenia 2016/522.`,
    );
  }
  if (cancelPeak) {
    paras.push(
      `Udział anulowanych zleceń kupna składanych przez rachunki Grupy sięgał ` +
        `${plnum(cancelPeak.value, "%")} (sesja ${cancelPeak.session_day}). Składanie i niezwłoczne ` +
        `anulowanie zleceń bez zamiaru ich realizacji odpowiada technikom layering i spoofing, ` +
        `wprowadzającym uczestników rynku w błąd co do rzeczywistego popytu i podaży.`,
    );
  }

  const table: OpTable | null = days.length
    ? {
        caption:
          "Tabela 1. Udział transakcji wzajemnych i anulacji kupna Grupy w poszczególnych sesjach",
        head: ["Sesja", "Wash-trades (% wolumenu)", "Anulacje kupna (%)"],
        rows: days.map((d) => {
          const w = metrics.find((m) => m.session_day === d && m.key.startsWith("wash_"));
          const c = metrics.find((m) => m.session_day === d && m.key.startsWith("cancel_"));
          return [d, w ? plnum(w.value, "%") : "—", c ? plnum(c.value, "%") : "—"];
        }),
      }
    : null;

  const findings: string[] = [];
  if (groupShare?.value != null)
    findings.push(
      `Udział Grupy w wartości obrotu (${plnum(groupShare.value, "%")}) wskazuje na zdolność ` +
        `wywierania dominującego wpływu na kształtowanie kursu instrumentu.`,
    );
  if (washPeak?.value != null)
    findings.push(
      `Transakcje wzajemne (do ${plnum(washPeak.value, "%")} wolumenu sesji) generowały pozorny ` +
        `obrót, mogący wprowadzać w błąd co do płynności instrumentu.`,
    );
  if (cancelPeak?.value != null)
    findings.push(
      `Wysoki udział anulacji zleceń kupna (do ${plnum(cancelPeak.value, "%")}) wskazuje na ` +
        `działania zmierzające do wywołania mylnego wyobrażenia o popycie.`,
    );

  return {
    kind: "ilosciowa",
    chapterNo: "IV.3",
    title: "Analiza ilościowa aktywności Grupy",
    bodyMd: paras.join("\n\n"),
    data: { table, findings, legalRefs: ["art. 12 MAR", "RD 2016/522, zał. II"] },
  };
}

// Dynamika kursu z notowania-engine (lib/quotes/parse.ts).
export type QuoteDyn = {
  from: string;
  to: string;
  start: number;
  end: number;
  maxClose: number;
  peakDate: string;
  changeStartMaxPct: number;
  changeStartEndPct: number;
};

// ── Generator subanalizy eko-fin — szkielet rozdz. IV.1 z faktami z inwentarza ──
// Otoczenie rynkowe jest częściowo jakościowe: fakty z inwentarza akt oraz
// policzona dynamika kursu są ugruntowane, a ocena fundamentalna pozostaje do
// uzupełnienia przez biegłego.
export function buildEkofinSubanaliza(
  metrics: Metric[],
  documents: Doc[],
  quotes?: QuoteDyn | null,
): SubResult {
  const days = [
    ...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day as string)),
  ].sort();
  const period = days.length ? `od ${days[0]} do ${days[days.length - 1]}` : "[okres do uzupełnienia]";
  const byType = (t: string) => documents.filter((d) => d.doc_type === t);
  const espi = byType("RAPORT_ESPI_EBI");
  const fin = byType("SPRAWOZDANIE_FIN");
  const notow = byType("NOTOWANIA_REF");
  const stanp = byType("ZAWIAD_STAN_POSIADANIA");
  const lst = (ds: Doc[], n = 15) =>
    ds.slice(0, n).map((d) => "• " + basename(d.rel_path)).join("\n") +
    (ds.length > n ? `\n• … (+${ds.length - n})` : "");

  const sec: string[] = [];
  sec.push(
    `Celem niniejszej analizy jest ustalenie, czy zmiana kursu instrumentu w okresie ${period} ` +
      `znajduje uzasadnienie w sytuacji ekonomiczno-finansowej spółki oraz w publicznie dostępnych ` +
      `informacjach, czy też ma charakter oderwany od fundamentów — co wzmacniałoby tezę o manipulacji.`,
  );
  sec.push(
    `Dynamika kursu i wolumenu. ` +
      (quotes
        ? `W okresie od ${quotes.from} do ${quotes.to} kurs zmienił się z ${plnum(quotes.start, "zł")} ` +
          `(początek) do maksymalnie ${plnum(quotes.maxClose, "zł")} w dniu ${quotes.peakDate} — wzrost ` +
          `o ${plnum(quotes.changeStartMaxPct, "%")}. Kurs na koniec okresu: ${plnum(quotes.end, "zł")} ` +
          `(${plnum(quotes.changeStartEndPct, "%")} względem początku). ` +
          `[Do uzupełnienia: czy skala zmiany kursu znajduje uzasadnienie w fundamentach.]`
        : (notow.length
            ? `W aktach znajdują się dane notowań (${notow.length}) — wygeneruj subanalizę, aby policzyć ` +
              `kurs początkowy, maksymalny i skalę wzrostu. `
            : `Brak w aktach danych notowań do wyznaczenia dynamiki kursu. `) +
          `[Do uzupełnienia: kurs początkowy, kurs maksymalny, procentowa zmiana, data szczytu.]`),
  );
  sec.push(
    `Sytuacja finansowa spółki. ` +
      (fin.length
        ? `W aktach zidentyfikowano ${fin.length} dokument(ów) finansowych (sprawozdania / plany rozwoju):\n${lst(fin)}\n`
        : `Brak w aktach sprawozdań finansowych. `) +
      `[Do uzupełnienia: czy wyniki i perspektywy spółki uzasadniają zaobserwowaną zmianę kursu.]`,
  );
  sec.push(
    `Informacje publiczne (raporty ESPI/EBI). ` +
      (espi.length
        ? `W okresie objętym analizą spółka publikowała raporty bieżące/okresowe. W aktach ` +
          `zidentyfikowano ${espi.length} raport(ów):\n${lst(espi)}\n`
        : `Brak w aktach raportów ESPI/EBI. `) +
      `[Do uzupełnienia: czy którykolwiek raport miał charakter cenotwórczy i tłumaczy ruch kursu.]`,
  );
  if (stanp.length)
    sec.push(
      `Zmiany stanu posiadania. Zidentyfikowano ${stanp.length} zawiadomienie(a) o zmianie stanu ` +
        `posiadania — istotne dla oceny przepływu pakietów i powiązania z dynamiką kursu.`,
    );
  sec.push(
    `Ocena. [Do uzupełnienia przez biegłego: czy fundamenty i informacje publiczne uzasadniają ` +
      `zaobserwowaną dynamikę kursu. Brak takiego uzasadnienia wzmacnia tezę o oderwaniu ceny od ` +
      `wartości i o manipulacji instrumentem finansowym.]`,
  );

  const findings: string[] = [];
  if (quotes)
    findings.push(
      `Kurs wzrósł o ${plnum(quotes.changeStartMaxPct, "%")} (z ${plnum(quotes.start, "zł")} do ` +
        `${plnum(quotes.maxClose, "zł")}, szczyt ${quotes.peakDate}).`,
    );
  findings.push(
    `W aktach zidentyfikowano: ${espi.length} raport(ów) ESPI/EBI, ${fin.length} dokument(ów) ` +
      `finansowych, ${notow.length} zbiór(ów) notowań, ${stanp.length} zawiadomień o stanie posiadania.`,
  );

  return {
    kind: "ekofin",
    chapterNo: "IV.1",
    title: "Analiza ekonomiczno-finansowa i otoczenie rynkowe",
    bodyMd: sec.join("\n\n"),
    data: {
      table: null,
      findings,
      legalRefs: ["art. 7 MAR (informacja poufna)", "art. 17 MAR (raporty bieżące)"],
    },
  };
}

// ── Generator subanalizy porozumienia — rozdz. IV.4 (IP + relacje osobowe) ──
// Dowód „wspólnie i w porozumieniu". Inwentarz dowodów jest ugruntowany; sama
// ocena zbieżności IP i relacji pozostaje do uzupełnienia/weryfikacji przez biegłego
// (pliki źródłowe UKNF często zawierają już gotowe zestawienia zbieżności).
export function buildPorozumienieSubanaliza(metrics: Metric[], documents: Doc[]): SubResult {
  void metrics;
  const byType = (t: string) => documents.filter((d) => d.doc_type === t);
  const ip = byType("DANE_IP");
  const osint = byType("ANALIZA_OSINT");
  const broker = byType("DANE_BROKERSKIE");
  const lst = (ds: Doc[], n = 15) =>
    ds.slice(0, n).map((d) => "• " + basename(d.rel_path)).join("\n") +
    (ds.length > n ? `\n• … (+${ds.length - n})` : "");

  const sec: string[] = [];
  sec.push(
    `Celem analizy jest ustalenie, czy aktywność rachunków na instrumencie nosi znamiona działania ` +
      `wspólnie i w porozumieniu (skoordynowania), w oparciu o zbieżność adresów IP, relacje osobowe ` +
      `oraz wzorce czasowe składanych zleceń.`,
  );
  sec.push(
    `Zbieżność adresów IP. ` +
      (ip.length
        ? `W aktach znajdują się dane logowań i adresów IP (${ip.length}):\n${lst(ip)}\n`
        : `Brak w aktach danych logowań/IP. `) +
      `[Do uzupełnienia: które adresy IP były współdzielone przez różne rachunki Grupy i w jakich sesjach.]`,
  );
  sec.push(
    `Relacje osobowe. ` +
      (osint.length
        ? `W aktach znajduje się analiza OSINT / graf powiązań (${osint.length}):\n${lst(osint)}\n`
        : `Brak w aktach analizy OSINT / grafu powiązań. `) +
      `[Do uzupełnienia: zidentyfikowane relacje rodzinne i biznesowe między posiadaczami rachunków.]`,
  );
  sec.push(
    `Wspólni decydenci i pełnomocnicy. ` +
      (broker.length
        ? `Dane z firm inwestycyjnych (${broker.length}) umożliwiają ustalenie pełnomocników i osób ` +
          `faktycznie dysponujących rachunkami. `
        : ``) +
      `[Do uzupełnienia: wspólni pełnomocnicy/decydenci rachunków, wspólne dane kontaktowe.]`,
  );
  sec.push(
    `Wzorce czasowe. [Do uzupełnienia: zbieżność czasowa zleceń rachunków Grupy (z analizy ilościowej ` +
      `UTP — transakcje wzajemne i dopasowania) wskazująca na koordynację działań.]`,
  );
  sec.push(
    `Ocena. [Do uzupełnienia przez biegłego: czy zebrane okoliczności — zbieżność IP, relacje osobowe ` +
      `i wzorce czasowe — wskazują na działanie wspólnie i w porozumieniu w rozumieniu art. 12 MAR.]`,
  );

  const findings: string[] = [
    `W aktach zidentyfikowano: ${ip.length} zbiór(ów) danych IP/logowań, ${osint.length} analiz(ę) OSINT, ` +
      `${broker.length} zestawień z firm inwestycyjnych.`,
  ];

  return {
    kind: "porozumienie",
    chapterNo: "IV.4",
    title: "Porozumienie — zbieżność IP i relacje osobowe",
    bodyMd: sec.join("\n\n"),
    data: {
      table: null,
      findings,
      legalRefs: ["art. 12 ust. 1 MAR (manipulacja)", "art. 12 ust. 2 lit. a–c MAR"],
    },
  };
}

// ── Generator subanalizy OTC / motyw — rozdz. IV.5 (kto zyskał i dlaczego) ──
// Beneficjent i motyw. Inwentarz dowodów obrotu pozagiełdowego jest ugruntowany;
// szacunek korzyści i motyw pozostają do uzupełnienia przez biegłego (wymagają cen
// z umów i kursu rynkowego, których nie wyliczamy automatycznie).
export function buildOtcSubanaliza(metrics: Metric[], documents: Doc[]): SubResult {
  const days = [
    ...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day as string)),
  ].sort();
  const period = days.length ? `od ${days[0]} do ${days[days.length - 1]}` : "[okres do uzupełnienia]";
  const byType = (t: string) => documents.filter((d) => d.doc_type === t);
  const umowy = byType("UMOWA_CYWILNA");
  const stanp = byType("ZAWIAD_STAN_POSIADANIA");
  const lst = (ds: Doc[], n = 15) =>
    ds.slice(0, n).map((d) => "• " + basename(d.rel_path)).join("\n") +
    (ds.length > n ? `\n• … (+${ds.length - n})` : "");

  const sec: string[] = [];
  sec.push(
    `Celem analizy jest ustalenie, kto odniósł korzyść z zaobserwowanej w okresie ${period} dynamiki ` +
      `kursu oraz jaki był cel działań (motyw), w oparciu o obrót pozagiełdowy (umowy cywilnoprawne, ` +
      `transakcje pakietowe) i zmiany stanu posiadania.`,
  );
  sec.push(
    `Obrót pozagiełdowy (umowy cywilnoprawne). ` +
      (umowy.length
        ? `W aktach zidentyfikowano ${umowy.length} umów(y) zbycia/nabycia akcji poza rynkiem ` +
          `regulowanym:\n${lst(umowy)}\n`
        : `Brak w aktach umów cywilnoprawnych. `) +
      `[Do uzupełnienia: ceny nabycia pakietów poza rynkiem i ich relacja do kursu giełdowego.]`,
  );
  sec.push(
    `Zmiany stanu posiadania. ` +
      (stanp.length
        ? `Zidentyfikowano ${stanp.length} zawiadomienie(a) o zmianie stanu posiadania:\n${lst(stanp)}\n`
        : `Brak w aktach zawiadomień o zmianie stanu posiadania. `) +
      `[Do uzupełnienia: kierunek przepływu pakietów — kto zwiększał, a kto redukował zaangażowanie w ` +
      `okresie wzrostu kursu.]`,
  );
  sec.push(
    `Transakcje pakietowe. [Do uzupełnienia: transakcje pakietowe (block trades) w danych UTP — wolumen ` +
      `i ceny względem kursu rynkowego.]`,
  );
  sec.push(
    `Beneficjent i szacunek korzyści. [Do uzupełnienia przez biegłego: który podmiot odniósł korzyść ` +
      `majątkową oraz jej szacunkowa wartość — np. różnica między ceną nabycia pakietu (umowa) a ceną ` +
      `jego zbycia na rynku po wzroście kursu.]`,
  );
  sec.push(
    `Motyw. [Do uzupełnienia: cel działań — np. upłynnienie posiadanego pakietu po zawyżonym kursie ` +
      `(schemat pump&dump) albo uniknięcie straty. Wykazanie korzyści beneficjenta wzmacnia tezę o ` +
      `celowości manipulacji.]`,
  );

  const findings: string[] = [
    `W aktach zidentyfikowano: ${umowy.length} umów(y) cywilnoprawnych, ${stanp.length} zawiadomień o ` +
      `zmianie stanu posiadania.`,
  ];

  return {
    kind: "otc",
    chapterNo: "IV.5",
    title: "Motyw i beneficjent — obrót pozagiełdowy i przepływ pakietów",
    bodyMd: sec.join("\n\n"),
    data: {
      table: null,
      findings,
      legalRefs: ["art. 12 ust. 1 lit. a–b MAR", "art. 183 ustawy o obrocie instrumentami finansowymi"],
    },
  };
}

// ── Synteza Wniosków (rozdz. II) z ZATWIERDZONYCH subanaliz IV.x ──
// Deterministyczne zebranie wniosków cząstkowych + rozdzielenie ustaleń
// faktycznych od ocen zastrzeżonych dla sądu (kwalifikacja prawna, zamiar, wina).
export function buildWnioskiSubanaliza(stored: StoredSub[]): SubResult | null {
  const approved = stored
    .filter((s) => s.status === "zatwierdzona" && s.chapter_no.startsWith("IV"))
    .sort((a, b) => a.chapter_no.localeCompare(b.chapter_no, "pl"));
  if (!approved.length) return null;

  const parts: string[] = [
    `Na podstawie analiz przeprowadzonych w rozdziale IV formułuje się następujące wnioski.`,
  ];
  for (const s of approved) {
    const fs = (s.data?.findings ?? []).join(" ");
    parts.push(`${s.title} (rozdz. ${s.chapter_no}). ${fs}`.trim());
  }
  parts.push(
    `Powyższe ustalenia faktyczne wskazują łącznie na cechy manipulacji instrumentem finansowym w ` +
      `rozumieniu art. 12 rozporządzenia MAR. Ocena prawnokarna czynu oraz ustalenie zamiaru i winy ` +
      `konkretnych osób pozostają w wyłącznej kompetencji organu prowadzącego postępowanie oraz sądu.`,
  );

  return {
    kind: "wnioski",
    chapterNo: "II",
    title: "Wnioski",
    bodyMd: parts.join("\n\n"),
    data: {
      table: null,
      findings: [
        `Ustalenia faktyczne wskazują na cechy manipulacji instrumentem finansowym (art. 12 MAR); ` +
          `kwalifikacja prawnokarna i ocena zamiaru — w gestii sądu.`,
      ],
      legalRefs: ["art. 12 MAR"],
    },
  };
}

const SUB_LABEL: Record<string, string> = {
  ilosciowa: "ilościowa UTP (silnik faktów)",
  ekofin: "ekonomiczno-finansowa i otoczenie",
  porozumienie: "porozumienie (IP / OSINT)",
  otc: "obrót pozagiełdowy / motyw",
  wnioski: "synteza wniosków",
  proza_i: "redakcja rozdziału I (model)",
  proza_iii: "redakcja rozdziału III (model)",
  proza_v: "redakcja rozdziału V (model)",
};

// Rozdział opinii z zapisanej subanalizy (zatwierdzona → grounded/ready).
function chapterFromStored(s: StoredSub): Chapter {
  const conf: Conf = s.status === "zatwierdzona" ? "grounded" : "review";
  return {
    no: s.chapter_no,
    title: s.title,
    status: s.status === "zatwierdzona" ? "ready" : "draft",
    source:
      `Subanaliza: ${SUB_LABEL[s.kind] ?? s.kind}` +
      (s.status === "zatwierdzona" ? " · zatwierdzona" : " · szkic"),
    paras: splitParas(s.body_md).map((t) => ({ text: t, conf })),
    table: s.data?.table ?? undefined,
    findings: (s.data?.findings ?? []).map((t) => ({ text: t, conf: "grounded" as Conf })),
  };
}

// Podgląd subanalizy ilościowej „na żywo" (gdy nie zapisano jej jeszcze w bazie).
function liveQuantChapter(metrics: Metric[]): Chapter | null {
  const q = buildQuantitativeSubanaliza(metrics);
  if (!q) return null;
  return {
    no: q.chapterNo,
    title: q.title,
    status: "draft",
    source: "Subanaliza: ilościowa UTP (niezapisana — wygeneruj, aby edytować)",
    paras: splitParas(q.bodyMd).map((t) => ({ text: t, conf: "review" as Conf })),
    table: q.data.table ?? undefined,
    findings: q.data.findings.map((t) => ({ text: t, conf: "grounded" as Conf })),
  };
}

export function buildOpinion(
  caseRow: { name: string; signature: string | null },
  metrics: Metric[],
  documents: Doc[],
  stored: StoredSub[] = [],
): Opinion {
  const inputDocs = documents.filter((d) => d.provenance !== "wyjście");

  // Rozdział IV — blok subanaliz (IV.x): zapisane + ewentualny podgląd ilościowy.
  const ivChapters: Chapter[] = stored
    .filter((s) => s.chapter_no.startsWith("IV"))
    .map(chapterFromStored);
  if (!stored.some((s) => s.kind === "ilosciowa")) {
    const live = liveQuantChapter(metrics);
    if (live) ivChapters.push(live);
  }
  ivChapters.sort((a, b) => a.no.localeCompare(b.no, "pl"));
  if (ivChapters.length === 0) {
    ivChapters.push({
      no: "IV",
      title: "Analiza",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text: "Brak subanaliz dla rozdziału IV — wygeneruj subanalizę ilościową lub eko-fin.",
        },
      ],
    });
  }
  const ivTable = ivChapters.find((c) => c.table)?.table ?? null;

  const chapters: Chapter[] = [
    {
      no: "I",
      title: "Przedmiot opinii i podstawa prawna",
      status: "draft",
      paras: [
        {
          conf: "review",
          text:
            `Przedmiotem opinii jest ocena, czy w obrocie instrumentem finansowym objętym sprawą` +
            `${caseRow.signature ? ` (sygn. ${caseRow.signature})` : ""} doszło do manipulacji w ` +
            `rozumieniu art. 12 MAR, a jeżeli tak — w jaki sposób i przez kogo.`,
        },
        {
          conf: "todo",
          text:
            "Do uzupełnienia: oznaczenie spółki i instrumentu, okres objęty analizą oraz pytania " +
            "organu zgodnie z treścią postanowienia o powołaniu biegłego.",
        },
      ],
    },
    {
      no: "II",
      title: "Wnioski",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text:
            "Sekcja generowana na etapie montażu po zatwierdzeniu subanaliz — synteza odpowiedzi na " +
            "pytania postanowienia, z rozdzieleniem ustaleń faktycznych od ocen zastrzeżonych dla sądu.",
        },
      ],
    },
    {
      no: "III",
      title: "Wstęp teoretyczny — techniki manipulacji",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text:
            "Warsztat teoretyczno-prawny (część III): definicje i wskaźniki manipulacji wg MAR i RD " +
            "2016/522 — moduł wielokrotnego użytku, do podłączenia.",
        },
      ],
    },
    ...ivChapters,
    {
      no: "V",
      title: "Podsumowanie",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text:
            "Podsumowanie generowane na etapie montażu (po subanalizie eko-fin, ESPI/EBI, porozumienia " +
            "i OTC/motywu).",
        },
      ],
    },
    {
      no: "VI",
      title: "Spis tabel i wykaz załączników",
      status: ivTable || inputDocs.length ? "ready" : "todo",
      paras: [
        {
          conf: ivTable ? "grounded" : "todo",
          text: ivTable
            ? "Tabela 1 — udział transakcji wzajemnych i anulacji kupna Grupy w poszczególnych sesjach."
            : "Spis tabel zostanie uzupełniony po wykonaniu analiz.",
        },
      ],
      attachments: inputDocs.slice(0, 300).map((d) => basename(d.rel_path)),
    },
  ];

  // Rozdziały stałe (I, II, III, V) nadpisuje zapisana subanaliza o tym numerze
  // (np. „Wnioski" jako subanaliza kind=wnioski, chapter_no=II). VI i blok IV.x
  // pozostają nietknięte.
  const exact = new Map(
    stored.filter((s) => !s.chapter_no.startsWith("IV")).map((s) => [s.chapter_no, s] as const),
  );
  const merged = chapters.map((c) =>
    c.no !== "VI" && exact.has(c.no) ? chapterFromStored(exact.get(c.no)!) : c,
  );

  return {
    caseName: caseRow.name,
    signature: caseRow.signature,
    expert: EXPERT,
    generatedAt: new Date().toISOString(),
    legalBasis: LEGAL_BASIS,
    chapters: merged,
  };
}
