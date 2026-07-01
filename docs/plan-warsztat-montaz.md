# Plan przebudowy: Warsztat dowodowy → Rozdziały → Montaż

Cel: wystawić realny proces biegłego (Kroki 2–10) jako warstwę roboczą w aplikacji,
zorganizowaną w zakładki (nie kafelki), z montażem opinii jako stepperem
zależnościowym. Plan zgodny z zasadami: **LLM nie liczy**, **evidence-only**
(finalna opinia KM oraz zawiadomienie UKNF/GPW = tylko wzorzec/zakres, nigdy
źródło tez), każdy artefakt z **provenance + mapą pewności + akceptacją człowieka**.

## 1. Informacyjna architektura — 3 grupy zakładek

Zamiast 11 zakładek w jednym pasku: 3 sekcje górne, każda z pod-zakładkami.

### A. Warsztat dowodowy (Kroki 2–6; wejście = dowody)
- **A1 Podmioty** (K2) — kandydaci z sygnałów dowodowych (wspólne IP, pary wash,
  zbieżność czasowa) + zakres z zawiadomienia jako seed; każdy kandydat z
  uzasadnieniem dowodowym; człowiek zatwierdza → roster Grupy. *(istnieje: roster-panel)*
- **A2 Techniki** (K3) — wybór z katalogu MAR art.12 (+ RD 2016/522); wynik buduje
  plan rozdziałów IV.
- **A3 Powiązania: dane** (K4) — korelacja IP + transakcje między rachunkami DM (silnik).
- **A4 Powiązania: OSINT** (K5) — KRS/rejestry, web, social, umowy cywilne, wspólne
  zarządy; każde powiązanie z cytowanym źródłem.
- **A5 Analiza liczbowa** (K6) — UTP (+ TREM). *(istnieje: silnik compute_all)*

### B. Rozdziały (drafty; Kroki 7–10)
- **B1 Kontekst ekon-fin** (R1) *(istnieje: ekofin)*
- **B2 Raporty ESPI/EBI** (R2) *(istnieje: espi)*
- **B3 Aktywność / relacje** (R3, R7) *(istnieje: aktywnosc/relacje)*
- **B4…Bn Uzasadnienia technik** (R4…) — **liczba dynamiczna z A2** *(istnieją buildery wash/imo/layering/pumpdump)*
- **Wnioski (II)**, **Wstęp – ujęcie teoretyczne (III)**, **Podsumowanie (V)** *(istnieją)*

### C. Montaż — stepper zależnościowy + eksport .docx
(Recenzent/QA zostaje jako przekrój nad całością.)

## 2. Model danych (minimalne zmiany)

Reuse tabeli `subanalyses` (kind/chapter_no/status/data jsonb) jako uniwersalny
magazyn artefaktów roboczych — większość zakładek to subanaliza. Nowe `kind`:
- `techniki` — wybrane techniki + uzasadnienie wyboru (buduje plan IV)
- `powiazania_dane` (A3), `powiazania_osint` (A4; data.sources[] z provenance)
- (istnieją) ekofin, espi, aktywnosc, relacje, wash, imo, layering, pumpdump, wnioski, proza_*

`cases.group_roster` (A1) — migracja 0005 (gotowa). Stan zależności wyliczany z
`status='zatwierdzona'` — bez osobnej tabeli.

## 3. Graf zależności (DAG) — co bramkuje co

```
A1 Podmioty ──► (group_fragments) ──► A3, A5
A2 Techniki ──► liczba/rodzaj B4…Bn (plan IV)
A5 Liczby (po A1) ──► B3, B4… , Wnioski
A3 + A4 Powiązania ──► B3 relacje
A1…A5 zatwierdzone ──► odblokowują B (rozdziały)
B (rozdziały IV) zatwierdzone ──► Wnioski (II)
Wnioski zatwierdzone ──► Wstęp (III) + Podsumowanie (V)
wszystko zatwierdzone ──► Montaż składa dokument I–VI
```

## 4. Montaż-stepper

- Lista kroków w **kolejności pisania** (warsztat → IV → II → III → V), nie w
  numeracji dokumentu.
- Każdy krok: status `zablokowany / gotowy / szkic / zatwierdzony` + akcje
  `generuj · edytuj · akceptuj · odrzuć`.
- Krok zablokowany dopóki przesłanki z DAG niezatwierdzone — pokaż czego brakuje.
- Po komplecie: podgląd w **kolejności dokumentu I–VI** + eksport .docx (route istnieje).
- Pasek postępu X/N rozdziałów.

## 5. Dynamiczne zakładki uzasadnień (B4…Bn)

- Generowane z A2 (techniki wybrane): jedna zakładka „Uzasadnienie: <technika>".
- Numer IV.x z planu sprawy, ale **plan jest WYNIKIEM A2** (z dowodów), nie zaszytym
  presetem. `chapters.casePlan` przechodzi z twardych Hub/MLM na plan budowany z A2;
  Hub/MLM zostają jako presety/seed.

## 6. Mapowanie na istniejący kod

Reuse: `subanalyses` + buildery (`lib/opinion/build.ts`), sub-taby
(`opinion-view.tsx`), `roster-panel.tsx`→A1, silnik (`engine/*`), eksport
(`opinion/docx/route.ts`), biblioteka prawna (`legal.ts`), plan (`chapters.ts`).

Nowe: A2 techniki (UI + zapis, buduje plan), A3 IP-korelacja (silnik), A4 OSINT
(route web/KRS + provenance + UI), Montaż-stepper (przepisanie zakładki Montaż),
`casePlan` z A2, parser TREM, funkcja korelacji IP.

## 7. Silnik — rozszerzenia (deterministyczne, golden-testowalne)

- **Korelacja IP** (A3): z arkusza zleceń → pary rachunków dzielących adres IP.
- **TREM** (A5): parser pliku UKNF + scalanie z UTP.

## 8. Roadmapa faz (każda: tsc/lint/pytest zielone + deploy)

- **Faza 0 (teraz):** deploy B-backbone + migracja 0005 → roster (A1) działa.
- **Faza 1:** IA — 3 grupy zakładek; roster→A1; nowa nawigacja (bez nowego silnika).
- **Faza 2:** A2 techniki → `casePlan` z A2 → dynamiczne B4…Bn.
- **Faza 3:** Montaż-stepper zależnościowy (rdzeń UX).
- **Faza 4:** A3 korelacja IP (silnik) + TREM.
- **Faza 5:** A4 OSINT (web/KRS + provenance) — najtrudniejsze, osobno, fazowo.

## 9. Decyzje

1. **Nawigacja — ROZSTRZYGNIĘTE:** górne 3 sekcje (Warsztat / Rozdziały / Montaż) z
   pod-zakładkami; sekcja Montaż = stepper. Oddziela eksploracyjny warsztat od
   bramkowanego montażu.
2. **A2 techniki — ROZSTRZYGNIĘTE:** app **proponuje techniki na podstawie sygnałów
   dowodowych** (deterministycznie z metryk silnika: anulacje → layering; wolumen
   wewnątrzgrupowy → wash; itd. z katalogu MAR art.12), biegły potwierdza/odrzuca.
   Propozycja techniki nosi swój sygnał-uzasadnienie; LLM tu nie rozstrzyga.
3. **OSINT (A4) — OTWARTE (Faza 5):** źródła na start (KRS API / web search / które
   social media?), budżet i kwestie legalności/ToS scrapowania.
4. **TREM — OTWARTE (Faza 4):** dostępny przykładowy plik TREM do napisania parsera?
