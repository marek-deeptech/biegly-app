# Podział pracy na dwa wątki: MANIPULACJE i SPRAWY BANKOWE

Ustalony 6.08.2026. Rozdzielamy **rozmowę**, nie aplikację: jedna instancja,
jedno repozytorium, `cases.typ` rozstrzyga dziedzinę. Klon oznaczałby dwie kopie
rendererów PDF/DOCX, korpusów stylu i wiedzy, klienta LLM i backupu — i rozjazd
po pierwszej poprawce.

## Gałęzie

| Wątek | Gałąź | Sprawy |
|---|---|---|
| Hochsztapler — Manipulacje | `manipulacje` | ZASTAL (CSY, RSY), HUBTECH, MLM |
| Hochsztapler — Sprawy bankowe | `bankowe` | SKOK (SK Bank), MBR |

Merge do `main` po przejściu pełnych testów. **Dwa agenty pushujące równolegle na
`main` to jedyny scenariusz, w którym można stracić pracę** — stąd gałęzie.

## Pliki WSPÓLNE — wymagają ostrożności

Zmiana w nich dotyka obu dziedzin. Rób ją **osobnym, małym commitem** z adnotacją
„dotyka obu dziedzin", żeby merge był trywialny.

```
lib/domain/index.ts            ← oba pakiety kroków w jednym pliku
lib/opinion/build-router.ts    ← wybór buildera po cases.typ
lib/opinion/pdf.ts, docx.ts    ← renderery
lib/opinion/wiedza.ts, wzorce.ts, korekty.ts   ← korpusy stylu i wiedzy
lib/llm/klient.ts, lib/llm/cennik.ts           ← pomiar kosztów
scripts/ingest_pozyskane.py, scripts/backup.py
scripts/opinia_wydruk.ts       ← wydruk obu dziedzin
app/cases/[id]/case-detail.tsx ← panel sprawy (stepper)
```

Pliki **wyłącznie bankowe**: `*-bank.ts`, `chronologia-*`, `przeklad_bps.py`,
`oceny_zrzeszajacego.py`, `engine/uslugi/bank.py`.
Pliki **wyłącznie manipulacyjne**: `ekofin*`, `aktywnosc-iv3`, `techniki-iv46`,
`braki-iv`, `redact-iv-input`, `spoofing*`, `engine/uslugi/{analyze,trem,spoofing}.py`.

## Zasady

1. **Pełne testy przed każdym pushem**: `npx vitest run` (z katalogu repo!) oraz
   `python3 -m pytest tests/ -q`. To one pilnują separacji — test
   „kroki 3-5 są ROZDZIELNE między dziedzinami" złapał realną regresję 5.08.
2. **Migracje SQL z zakresów**: manipulacje `0020–0029`, bankowe `0030–0039`.
   Obie sesje sięgnęłyby inaczej po `0019`.
3. **Wspólne pliki** — osobny commit, patrz wyżej.
4. **Pamięć**: wpisy są już podzielone po dziedzinach; `MEMORY.md` jest wspólny,
   więc dopisuj jedną linię na końcu sekcji, nie przebudowuj pliku.

## Pułapki wspólne dla obu wątków (drogo kupione)

- **PostgREST tnie odpowiedź do 1000 wierszy** niezależnie od `limit()` w zapytaniu
  i robi to CICHO. Do metryk zawsze `fetchAllMetrics` (TS) albo stronicowanie
  po `range()`. Rozdziały budowane na 1/6 metryk pisały „[do uzupełnienia]"
  o rzeczach policzonych.
- **Upsert szkieletem kasuje prozę i wzbogacone tabele.** Każdy skrypt
  przeliczający rozdział musi zachować `body_md` i oznaczyć go jako opisujący
  wcześniejszy odczyt.
- **Usługa kasująca metryki musi kasować TYLKO swoje klucze** (`key=in.(…)`),
  nie `case_id=eq.…`. Inaczej bieg jednego modułu wymazuje dorobek innego.
- **Okres badany bierze się z POSTANOWIENIA**, nigdy z zakresu metryk. W ZASTAL
  różnica wynosiła 3,5 miesiąca wobec niecałych dwóch lat.
- **`npx vitest` uruchamiaj z katalogu repo** — z katalogu domowego nie wczyta
  aliasu `@` i zgłosi „Cannot find package".

## Stan na moment podziału

**Manipulacje (ZASTAL)** — opinia `Opinia_ZASTAL_2026-08-06_v3.pdf`, 157 stron,
rozdział IV kompletny (7/7 podrozdziałów z prozą), Wnioski 14 434 zn.
Rejestr braków: `npx tsx scripts/braki_iv.ts ZASTAL` (7 pozycji, 5/7 podrozdziałów
kompletnych). Do zrobienia: odpisy KRS z API MS → IV.7, audyt opinii, notowania
CSY/RSY od debiutu (spółki wykluczone z obrotu — archiwum GPW/NewConnect).

**Bankowe (SKOK)** — opinia `Opinia_SKOK_2026-08-06_v4.pdf`, 111 stron.
Rubryka 16 wskaźników ma 17 wartości WŁASNYCH (policzonych z bilansu odczytanego
z obrazu) obok 99 wykazanych przez BPS; należności zagrożone 6,73 % → 21,84 %.
⚠️ **KOD tego kroku nie trafił do repozytorium** — dane są w bazie i mają źródło
(`ebi14_08.ocr.pdf`, `ebi14_14.ocr.pdf`, tabele z obrazu, strony w `data.zrodla`),
ale ścieżki nie da się dziś powtórzyć. Do odtworzenia w wątku bankowym.
