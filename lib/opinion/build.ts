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

// Wynik generatora subanalizy ilościowej (do zapisania w `subanalyses`).
export type QuantResult = {
  kind: "ilosciowa";
  chapterNo: "IV";
  title: string;
  bodyMd: string;
  data: { table: OpTable | null; findings: string[]; legalRefs: string[] };
};

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
type Doc = { rel_path: string; provenance: string | null };

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
    chapterNo: "IV",
    title: "Analiza ilościowa aktywności Grupy",
    bodyMd: paras.join("\n\n"),
    data: { table, findings, legalRefs: ["art. 12 MAR", "RD 2016/522, zał. II"] },
  };
}

function chapterIV(metrics: Metric[], stored?: StoredSub): Chapter {
  if (stored) {
    const conf: Conf = stored.status === "zatwierdzona" ? "grounded" : "review";
    return {
      no: "IV",
      title: stored.title || "Analiza ilościowa aktywności Grupy",
      status: stored.status === "zatwierdzona" ? "ready" : "draft",
      source: "Subanaliza: ilościowa UTP (silnik faktów)" + (stored.status === "zatwierdzona" ? " · zatwierdzona" : " · szkic"),
      paras: splitParas(stored.body_md).map((t) => ({ text: t, conf })),
      table: stored.data?.table ?? undefined,
      findings: (stored.data?.findings ?? []).map((t) => ({ text: t, conf: "grounded" as Conf })),
    };
  }
  const q = buildQuantitativeSubanaliza(metrics);
  if (!q) {
    return {
      no: "IV",
      title: "Analiza ilościowa aktywności Grupy",
      status: "todo",
      paras: [{ conf: "todo", text: "Brak policzonych wskaźników — wykonaj „Policz wskaźniki” na głównym pliku UTP." }],
    };
  }
  return {
    no: "IV",
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
  const byChapter = new Map(stored.map((s) => [s.chapter_no, s]));
  const inputDocs = documents.filter((d) => d.provenance !== "wyjście");
  const ivStored = stored.find((s) => s.kind === "ilosciowa") ?? byChapter.get("IV");
  const ivTable = chapterIV(metrics, ivStored).table;

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
    chapterIV(metrics, ivStored),
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

  return {
    caseName: caseRow.name,
    signature: caseRow.signature,
    expert: EXPERT,
    generatedAt: new Date().toISOString(),
    legalBasis: LEGAL_BASIS,
    chapters,
  };
}
