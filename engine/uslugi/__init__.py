"""Rdzenie funkcji serwerowych silnika — moduły przenoszone z `api/`.

DLACZEGO TU, A NIE W `api/`:
Vercel liczy KAŻDY plik `.py` w katalogu `api/` jako osobną funkcję serverless,
a plan Hobby dopuszcza ich dwanaście łącznie z trasami Next.js. Osiem modułów
Pythona zjadało dwie trzecie limitu i build zaczął padać. Tutaj są zwykłymi
modułami; jedyną funkcją serverless jest `api/silnik.py`, który do nich kieruje.

Katalog `engine/**` jest już dołączany do funkcji przez `includeFiles`
w vercel.json, więc przeniesienie nic nie kosztuje w rozmiarze pakietu.
"""
