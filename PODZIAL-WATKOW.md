# Podział pracy na dwa wątki: MANIPULACJE i SPRAWY BANKOWE

Ustalony 6.08.2026. Rozdzielamy **rozmowę**, nie aplikację: jedna instancja,
jedno repozytorium, `cases.typ` rozstrzyga dziedzinę. Klon oznaczałby dwie kopie
rendererów PDF/DOCX, korpusów stylu i wiedzy, klienta LLM i backupu — i rozjazd
po pierwszej poprawce.

## Katalogi robocze i gałęzie

| Wątek | Katalog roboczy | Gałąź | Sprawy |
|---|---|---|---|
| Hochsztapler — Manipulacje | `~/biegly-app` | `manipulacje` | ZASTAL (CSY, RSY), HUBTECH, MLM |
| Hochsztapler — Sprawy bankowe | `~/biegly-bankowe` | `bankowe` | SKOK (SK Bank), MBR |

Merge do `main` po przejściu pełnych testów.

### ⚠️ SAMA GAŁĄŹ NIE WYSTARCZA — potrzebny OSOBNY KATALOG

Pierwsza wersja tego dokumentu przewidywała tylko gałęzie. To okazało się
niewystarczające i zawiodło tego samego dnia: obie sesje pracowały w JEDNYM
katalogu `~/biegly-app`, więc widziały nawzajem swoje niezapisane pliki, a wątek
bankowy zacommitował cały przebieg MBR (siedem kroków, nowe panele i trasa) na
gałąź `manipulacje`. Wcześniej w drugą stronę: `git add -A` w wątku manipulacji
wciągnął bankowy `scripts/bilans_z_obrazu.py`.

Gałąź rozdziela HISTORIĘ, katalog rozdziela PLIKI. Bez tego drugiego dwa agenty
nadpisują sobie drzewo robocze i commitują cudzą pracę.

Katalog dla wątku bankowego zakłada się raz:

```bash
git worktree add ~/biegly-bankowe bankowe
cp ~/biegly-app/.env.local ~/biegly-bankowe/.env.local   # gitignore — nie kopiuje się sam
```

Od tej pory wątek bankowy pracuje WYŁĄCZNIE w `~/biegly-bankowe`, manipulacyjny
w `~/biegly-app`. Oba katalogi dzielą jedno repozytorium (`git worktree list`
pokazuje wszystkie), więc gałęzie, tagi i historia są wspólne — rozdzielone są
tylko pliki na dysku.

### Zabłąkane commity

Commit `f41cdb4` (przebieg bankowy MBR) trafił na gałąź manipulacji i został
z niej zdjęty; jest zachowany pod tagiem **`bankowe-kroki-mbr`**. Wątek bankowy
wciąga go do siebie:

```bash
cd ~/biegly-bankowe && git cherry-pick bankowe-kroki-mbr
```

Sprawdzenie przed każdym commitem: `git branch --show-current` musi zgadzać się
z dziedziną, której dotyczy zmiana.

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
- **Jedno źródło okresu badanego.** Każdy rozdział liczbowy bierze okno z
  `lib/opinion/okres.ts` (konfiguracja kroku 4 = daty z postanowienia), nigdy
  z zakresu metryk ani z własnej flagi. Inaczej ta sama faza wzrostowa CSY wychodzi
  +1175 % w IV.1 i +920 % w IV.5 — obie policzone poprawnie, sprzeczne wejściem.
- **Liczby PER INSTRUMENT.** Sprawa może obejmować kilka walorów; zestaw łączny
  sumuje wolumeny różnych papierów i podstawia kurs jednego pod oba
  (`lib/opinion/instrumenty.ts`, `czyZmieszane`).
- **`npx vitest` uruchamiaj z katalogu repo** — z katalogu domowego nie wczyta
  aliasu `@` i zgłosi „Cannot find package".

## Stan na moment podziału

**Manipulacje (ZASTAL)** — opinia `Opinia_ZASTAL_2026-08-07_v9.pdf`, 171 stron.
Wszystkie rozdziały liczbowe (IV.1, IV.3–IV.6, fixing, koncentracja) liczone PER
INSTRUMENT i w oknie z postanowienia (11.12.2017–30.09.2019). Faza wzrostowa:
CSY +920 %, RSY +742,86 %. Rejestr braków: `npx tsx scripts/braki_iv.ts ZASTAL`
(7 pozycji, 5/7 podrozdziałów kompletnych). Bramka przed wydrukiem:
`npx tsx scripts/audyt_okresu.ts ZASTAL --poboczne 2019-09-27`.

⚠️ **Do decyzji biegłego:** `fixing` (CSY 39 sesji ≥50 % wolumenu fixingu, RSY 42)
i `concentration` (CSY 127 sesji, RSY 116) są policzone i zredagowane, ale NIE
wchodzą do opinii — zatwierdzony dobór technik obejmuje wash, pumpdump, layering.

Do zrobienia: odpisy KRS z API MS → IV.7, audyt opinii, notowania CSY/RSY od debiutu
(spółki wykluczone z obrotu — archiwum GPW/NewConnect), rekalibracja progu layeringu
(1000 szt. wyliczone na medianie ZESTAWU ŁĄCZNEGO; mediany per instrument to 303 CSY
i 168 RSY).

**Bankowe (SKOK)** — opinia `Opinia_SKOK_2026-08-06_v4.pdf`, 111 stron.
Rubryka 16 wskaźników ma 17 wartości WŁASNYCH (policzonych z bilansu odczytanego
z obrazu) obok 99 wykazanych przez BPS; należności zagrożone 6,73 % → 21,84 %.
⚠️ **KOD tego kroku nie trafił do repozytorium** — dane są w bazie i mają źródło
(`ebi14_08.ocr.pdf`, `ebi14_14.ocr.pdf`, tabele z obrazu, strony w `data.zrodla`),
ale ścieżki nie da się dziś powtórzyć. Do odtworzenia w wątku bankowym.
