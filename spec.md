# SkiErg Training – Spec v1

> **Till kodagenten.** Det här dokumentet beskriver version 1 av appen. Det ersätter tidigare `AGENTS.md` och Roadmap (50 steg). Begreppen FTP, TSS och MSS från de gamla dokumenten används inte längre.
> Allt som listas under §2.2 *Utanför scope* ska **inte** byggas nu, inte heller i förenklad form.

---

## 0. Arbetsregler

- **Ordning:** Bygg i den ordning som anges i §12 (steg 0–3). Ett steg i taget. Varje steg ska uppfylla sina acceptanskriterier innan nästa påbörjas.
- **Beslutsnivåer:** Punkter märkta **[LÅST]** får inte ändras. Punkter märkta **[FÖRSLAG]** får ändras om du motiverar varför i commit- eller PR-beskrivningen.
- **[VERIFIERA]:** PM5-protokollet skrevs ursprungligen ur minnet. Det som är bekräftat mot en riktig PM5 är märkt så i §9. Det som fortfarande är märkt [VERIFIERA] ska kontrolleras mot rådata innan du bygger vidare på det. `demo/` (committas inte) innehåller kod som fungerar mot en riktig PM5 och är facit vid tveksamheter.
- **Ren modellkod:** Funktionerna i §5 och §6.2 ska vara rena funktioner utan beroenden till UI, BLE eller lagring, och ha enhetstester.
- **Språk:** Kod, identifierare och kommentarer på engelska. UI-texter på svenska.
- **Enheter internt:** watt (W), joule (J), sekunder (s), meter (m). Tid lagras som sekunder (flyttal) relativt passets start.
- **Beroenden:** Lägg inte till bibliotek utöver de i §3 utan att fråga.
- **Vid oklarhet:** Fråga hellre än att gissa, särskilt kring fysiologiska formler.

---

## 1. Syfte

En webbapp för Concept2 SkiErg med PM5-monitor som:

1. läser data i realtid från PM5 via USB (WebHID), eller via Web Bluetooth,
2. visar en rullande vy där målzonen syns 60 s framåt i tiden,
3. modellerar användarens kapacitet med en **Fitness Signature** (PP, CP, W′),
4. visar W′-balans (ett "batteri") och MPA (maximal tillgänglig effekt just nu) live.

**Kvalitetsmål för v1:** Användaren kan träna med appen direkt och ser något som PM5 själv inte visar.

---

## 2. Scope

### 2.1 I scope (v1)

- Anslutning till PM5 via USB (WebHID + CSAFE) som standard och via Web Bluetooth som alternativ, plus en simulator med samma gränssnitt
- Lokal lagring (IndexedDB) med rådata per drag och autosparning under passet
- Rullande livevy med målband, effekt, MPA-linje och W′-batteri
- Passformat i JSON, med tre inbyggda pass och läget "Fri åkning"
- Fitness Signature per maskintyp: manuell inmatning samt 3-punktstest med kurvanpassning
- Vy efter passet och en enkel historiklista
- Backup av databasen som JSON (export och import)

### 2.2 Utanför scope – bygg inte

**Planeras till v2** (kräver data från v1 eller formler som inte är klara):

- Signaturen över tid (breakthrough-detektering och decay)
- Low/High/Peak Load
- Separat pulsband samt HRR30/HRR60-analys
- Form Check och träningsrekommendationer
- Gamification (Vasaloppet som kampanjkarta, Monster Masters)
- FIT-export och import från Concept2 Logbook
- PWA och offline-läge
- Passeditor i gränssnittet
- Kraftkurva per drag

**Senare eller aldrig:**

- Passgenerator och maskininlärning
- ATL/CTL per energisystem
- Stöd för RowErg och BikeErg (datamodellen ska dock klara flera maskintyper, se §5.1)
- Styrning av PM5 med CSAFE-kommandon, till exempel att programmera pass. Att *läsa* data via USB ingår i v1 (§9.1).
- Backend, konton och synk
- Stöd för iOS

---

## 3. Beslut

| Område | Beslut | Status |
|---|---|---|
| Plattform | Webbapp för Chrome och Edge (desktop och Android). WebHID och Web Bluetooth kräver HTTPS eller `localhost`, och första anslutningen kräver ett användarklick. iOS stöds inte. | [LÅST] |
| PM5-anslutning | USB (WebHID + CSAFE) är standard. En PM5 som användaren redan godkänt ansluts automatiskt när den sitter i, både vid sidladdning och när sladden kopplas in. Web Bluetooth används bara när användaren väljer det. | [LÅST] |
| Fysiologisk modell | Fitness Signature (PP, CP, W′) med Mortons 3-parametermodell (§5.2). | [LÅST] |
| PP-definition | PP är modellens värde när t går mot 0: `PP = CP + W′/k`. | [LÅST] |
| Passkontroll | Appen styr passet genom målen på skärmen. PM5 körs i läget "Just Ski". Appen skickar inga kommandon för att programmera PM5. | [LÅST] |
| Tidsbas | Appens klocka (`Clock`, §4.2) styr tidslinjen. PM5:s elapsed time sparas men styr ingenting. | [LÅST] |
| Språk och bygg | TypeScript och Vite, inget UI-ramverk. | [FÖRSLAG] |
| Livevyn | Canvas 2D med egen ritkod. | [FÖRSLAG] |
| Grafer efter passet | uPlot. | [FÖRSLAG] |
| Lagring | IndexedDB via paketet `idb`. | [FÖRSLAG] |
| Tester | Vitest. | [FÖRSLAG] |

---

## 4. Arkitektur

### 4.1 Katalogstruktur

```
src/
  core/        clock.ts, events.ts            (klocka, typad event-buss)
  sources/     DataSource.ts, simulator.ts
               rawlog.ts                      (felsökningslogg, §12 steg 0)
               pm5/  uuids.ts, parse.ts, ble.ts (Bluetooth)
                     csafe.ts, usb.ts           (USB)
  model/       signature.ts, morton3p.ts, fit3p.ts, resample.ts, wbal.ts, mpa.ts
  workout/     schema.ts, expand.ts, runner.ts, builtin/*.json
  session/     recorder.ts, summary.ts
  storage/     db.ts, backup.ts
  ui/          views/ (start, live, test, session, history, settings)
               live/canvas.ts
tests/
  fixtures/    rå hex från riktig PM5 (steg 0)
```

### 4.2 Klocka

```ts
interface Clock { now(): number }   // sekunder, monoton
```

- `RealClock` bygger på `performance.now() / 1000`.
- `SimClock` har en hastighetsfaktor (1×, 5×, 20×) och används bara med simulatorn och i tester.

### 4.3 Dataflöde

```
DataSource (PM5 | Simulator)
   │  StrokeSample, StatusSample
   ├──────────────► Recorder ──► IndexedDB (chunkar var 30:e s)
   ▼
Resampler (effekt 1 Hz)
   ▼
WbalTracker + MPA ──► LiveState ──► Livevy (Canvas, requestAnimationFrame)
   ▲
WorkoutRunner (Clock + Timeline)
```

### 4.4 Typer

```ts
type Machine = 'skierg' | 'rowerg' | 'bikeerg';

interface StrokeSample {
  ts: number;           // Clock.now() när datan togs emot
  pmElapsed: number;    // s, från PM5
  power: number;        // W, effekt för draget
  strokeRate: number;   // drag/min
  strokeCount: number;
  distance: number;     // m, total
  raw?: Record<string, number>; // övriga tolkade fält, sparas oförändrade
}

interface StatusSample {
  ts: number;
  pmElapsed: number;
  distance: number;
  strokeRate?: number;
  heartRate?: number;   // bara om PM5 levererar ett giltigt värde
  paceSecPer500?: number;
}

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface DataSource {
  readonly kind: 'pm5' | 'simulator';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onStroke(cb: (s: StrokeSample) => void): () => void;
  onStatus(cb: (s: StatusSample) => void): () => void;
  onConnection(cb: (c: ConnectionState) => void): () => void;
  machine(): Machine | null;   // null om maskintypen är okänd
}
```

Källorna stämplar varje sample med `clock.now()`. Recordern räknar om till `t = ts − sessionStartTs` när datan sparas.

---

## 5. Fysiologisk modell

### 5.1 Fitness Signature

```ts
interface FitnessSignature {
  id: string;
  machine: Machine;
  pp: number;       // W
  cp: number;       // W
  wPrime: number;   // J
  createdAt: string;         // ISO 8601
  source: 'manual' | 'test3p';
  testResultIds?: string[];
}
```

- **Härlett värde:** `k = wPrime / (pp − cp)`, i sekunder.
- **Validering:** `pp > cp > 0` och `wPrime > 0`.
- **Lagring:** Signaturer sparas append-only per maskintyp. Den aktiva signaturen är den senaste för aktuell maskin.
- **Simulatorns standardvärden** (inga riktiga värden): PP 500 W, CP 200 W, W′ 15 000 J, vilket ger k = 50 s.
- **Standardsignatur för PM5** (användarens beslut 2026-09-24): PP 430 W, CP 180 W, W′ 10 000 J, vilket ger k = 40 s. Den används när ingen egen signatur finns sparad för maskinen och sparas inte i databasen. Simulatorn behåller sina egna standardvärden.

### 5.2 Power-duration: Mortons 3-parametermodell

```
P(t) = CP + W′ / (t + k)
     = CP + (PP − CP) · k / (t + k)
```

- **Tid till utmattning** vid konstant effekt P > CP: `t = W′ / (P − CP) − k`. Om resultatet är ≤ 0 är effekten omöjlig enligt modellen.
- **Namngivning:** I tidigare anteckningar kallades formeln Peronnet–Thibault. Den motsvarar algebraiskt Mortons 3-parametermodell (1996). Kalla den `morton3p` i koden.

### 5.3 Kurvanpassning från test (`fit3p`)

**Indata:** minst tre punkter `(t_i, P_i)`, där `P_i` är medeleffekten under en maxinsats som varade `t_i` sekunder.

**Metod:** För ett fast k är modellen linjär, `P_i = CP + W′ · x_i` med `x_i = 1 / (t_i + k)`. Därför:

1. Gå igenom k från 1 till 300 s i steg om 0,5 s. För varje k, lös CP och W′ med minsta kvadrat och räkna ut kvadratsumman av felen (SSE).
2. Förfina runt bästa k med gyllene snittet-sökning, tolerans 0,01 s.
3. Returnera `{ cp, wPrime, k, pp: cp + wPrime / k, sse }`.

**Validering:** `cp > 0`, `wPrime > 0`, `pp > cp`, och k får inte hamna på sökintervallets kant. Om något faller returneras ett fel med en begriplig förklaring, och UI:t föreslår manuell inmatning.

**Referenstest** (verifierat numeriskt):

| Indata | Förväntat resultat |
|---|---|
| (30 s, 440,83 W), (180 s, 285,54 W), (600 s, 236,78 W) | CP 211 ± 1 W, k 42 ± 1 s, W′ 16 548 ± 300 J, PP 605 ± 5 W |

### 5.4 Resampling till 1 Hz

W′-balans och MPA räknas på en effektserie med en punkt per sekund:

- **Hållning:** Effekten i en given sekund är effekten från senast avslutade drag.
- **Stillastående:** Om inget nytt drag kommit på mer än 4 s sätts effekten till 0 W. [FÖRSLAG, konstant]
- **Passets början:** Före första draget är effekten 0 W.

### 5.5 W′-balans

Tillståndet `wbal` (J) startar på W′. För varje sekund med effekten p (Δt = 1 s):

```
om p > CP:   wbal = wbal − (p − CP) · Δt
annars:      D   = CP − p
             τ   = 546 · e^(−0,01 · D) + 316
             wbal = W′ − (W′ − wbal) · e^(−Δt / τ)
```

- **Negativt värde:** `wbal` får bli negativ. Den lagras som den är, men visas som 0 % med markeringen "över modellen". Hantering av breakthroughs kommer i v2.
- **Konstanter:** 546, 0,01 och 316 kommer från cykling (Skiba 2012) och ska ligga som konfigurerbara konstanter.
- **Tid till tomt** vid aktuell effekt p > CP: `max(wbal, 0) / (p − CP)`.

**Referenstester** (verifierade numeriskt):

| Scenario | Förväntat |
|---|---|
| CP 250, p = 0 W | τ ≈ 360,8 s |
| CP 250, p = 200 W | τ ≈ 647,2 s |
| W′ 20 000 J, CP 250: 60 s på 350 W | wbal = 14 000 J |
| …följt av 60 s på 0 W | wbal ≈ 14 919 J |

### 5.6 MPA (maximal tillgänglig effekt)

```
MPA = CP + max(wbal, 0) / k
```

Med fullt W′ blir MPA lika med PP. När W′ är tomt blir MPA lika med CP. Definitionen ersätter den tidigare formeln "TP + HIE_remaining / time_to_exhaustion", som var cirkulär.

### 5.7 Färgzoner för W′

| wbal / W′ | Färg | Betydelse |
|---|---|---|
| ≥ 60 % | grön | |
| 40–60 % | gul | |
| 30–40 % | orange | varning |
| < 30 % | röd | "avsluta intervallet" (visas inte i testläge) |

Gränserna ska vara konfigurerbara konstanter.

---

## 6. Pass

### 6.1 Format

```json
{
  "id": "4x4-threshold",
  "name": "4×4 min tröskel",
  "segments": [
    { "kind": "warmup",   "duration": 600, "target": { "pctCP": 60 } },
    { "kind": "interval", "duration": 240, "target": { "pctCP": 105 }, "repeat": 4,
      "rest": { "duration": 120, "target": { "pctCP": 40 } } },
    { "kind": "cooldown", "duration": 300, "target": { "pctCP": 50 } }
  ]
}
```

- **`target`** är ett av följande: `{ "watt": number }`, `{ "pctCP": number }`, `{ "max": true }` (testinsats, inget band) eller `null` (inget mål). `pctCP` räknas om till watt när passet expanderas, med den aktiva signaturen.
- **`kind`** är ett av: `warmup`, `interval`, `rest`, `steady`, `cooldown`, `test`.
- **`repeat` och `rest`:** Vilan läggs *mellan* repetitionerna, inte efter den sista.
- **`tolerance`** (valfri per segment): relativ andel av målet. Standard ±5 % [FÖRSLAG].
- **Saknad signatur:** Om passet använder `pctCP` men ingen signatur finns, får användaren välja mellan att mata in en signatur eller köra passet utan mål.

### 6.2 Expansion

`expand(workout, signature) → Timeline` ger en platt lista:

```ts
interface TimelineSegment {
  start: number; end: number;          // s från passets start
  kind: string; label: string;         // label t.ex. "Intervall 2/4"
  targetW: number | null;              // null = inget mål
  lo: number | null; hi: number | null;
  isMax: boolean;
}
```

**Referenstest:** 4×4-exemplet ger 9 segment (uppvärmning, 4 intervaller, 3 vilor, nedvarvning) och total längd 2 220 s. Med CP 200 W blir intervallmålet 210 W och bandet 199,5–220,5 W.

### 6.3 WorkoutRunner

- **Tillstånd:** `idle → countdown (5 s) → running ⇄ paused → finished`.
- **Tidslinjen** följer klockan, inte prestationen.
- **Paus:** Tidslinjen fryses. Datainspelningen fortsätter och markeras som pausad. W′-balansen fortsätter att räknas med effekten från resamplern, så att återhämtningen under pausen blir korrekt.
- **Avbrott:** Om användaren stoppar i förtid sparas passet med status `aborted`.
- **Segmentbyte:** Tre korta pip (Web Audio) under de sista tre sekunderna före nytt segment. [FÖRSLAG]

### 6.4 Inbyggda pass

1. **4×4 min tröskel:** exemplet i §6.1.
2. **8×1 min hårt:** 10 min uppvärmning på 60 % CP, sedan 8 × (1 min på 130 % CP / 1 min på 40 % CP), sist 5 min nedvarvning på 50 % CP.
3. **30 min jämnt:** 30 min på 75 % CP.
4. **Fri åkning:** Ett eget läge utan tidslinje. Livevyn visar effekt, MPA och W′-batteri men inget målband. Passet pågår tills användaren stoppar.

Testpassen beskrivs i §7.

---

## 7. 3-punktstest

### 7.1 Testpassen

Det finns tre separata testpass: `test-30s`, `test-180s` och `test-600s`. Alla har samma upplägg:

1. 10 min uppvärmning på 50–60 % CP, med 2 × 10 s ökningar mot slutet (utan mål om signatur saknas)
2. 3 min lätt
3. Maxinsatsen (`target: { "max": true }`)
4. 5 min nedvarvning

UI-texten ska rekommendera att de tre testen görs olika dagar.

### 7.2 Testläge

- Inga varningar för W′ under maxinsatsen.
- Stor nedräkning och texten "MAX" i stället för målband.
- Löpande medeleffekt för insatsen visas stort.

### 7.3 Resultat

- **Testresultat:** medeleffekten under maxsegmentet, räknad från den 1 Hz-resamplade effekten. Sparas som `TestResult { id, sessionId, machine, duration, avgPower, date }`.
- **Förslag på ny signatur:** När det finns ett resultat för alla tre längder inom 14 dagar kör appen `fit3p` och föreslår en ny signatur. Användaren godkänner eller avböjer. Om det finns flera resultat för samma längd används det senaste.
- **Resultatvy:** De tre punkterna med den anpassade kurvan för 10 s till 30 min (logaritmisk x-axel). Den tidigare signaturens kurva visas streckad som jämförelse.

### 7.4 Manuell signatur

Under inställningar kan användaren mata in PP, CP och W′ direkt, med validering enligt §5.1.

---

## 8. Vyer

**Gemensamt för alla vyer:** mörkt tema som standard och stor typografi, eftersom siffrorna ska gå att läsa på 2–3 meters avstånd. Screen Wake Lock hålls aktivt under pass, och det finns en knapp för helskärm.

### 8.1 Start

- Knappar för "Anslut PM5 via USB", "Anslut via Bluetooth" och "Använd simulator", plus anslutningsstatus.
- Panelen "Felsökning": logga rådata, visa rå hex bredvid tolkade drag och ladda ned loggen som JSON.
- Aktiv signatur. Standardvärden (§5.1) visas som sådana, med en uppmaning att göra test eller mata in egna.
- Val av pass (inbyggda pass, testpass, fri åkning) och startknapp.

### 8.2 Livevy

**Canvas (cirka 70 % av ytan):**

- **X-axel:** från t − 60 s till t + 60 s, med en lodrät "nu"-linje i mitten. Vyn rullar mjukt.
- **Y-axel:** fast skala per pass, från 0 till `max(högsta målet i passet × 1,4, CP × 1,5)`. Om MPA-linjen hamnar ovanför skalan ritas den i överkant med en pil och en etikett med värdet.
- **Målband:** fylld yta och mållinje, både bakåt och framåt i tiden.
- **Effekt:** medelvärdet av de 3 senaste dragen (antalet konfigurerbart). Linjen är grön inom bandet, orange under och röd över.
- **MPA:** streckad linje.
- **CP:** tunn referenslinje.
- **Segmentgränser:** lodräta linjer med etiketter framåt, till exempel "Vila 2:00".

**Sidopanel:**

- W′-batteri, vertikalt, med procent och färg enligt §5.7
- Effekt (3-dragsmedel), dragtakt, puls om den finns
- Tid kvar i segmentet och nästa segment
- Tid till tomt W′, om effekten ligger över CP

**Prestanda:** Rita med `requestAnimationFrame`. Vyn ska hålla 30 fps utan hack.

### 8.3 Efter passet

- **Graf för hela passet (uPlot):** målband, effekt i 1 Hz och W′-balans på en högeraxel.
- **Sammanfattning:** tid, distans, medeleffekt, arbete i kJ, lägsta W′ (procent och när).
- **Tabell per intervall:** mål, medeleffekt och andel tid inom bandet.

### 8.4 Historik

En lista med datum, pass, tid, distans, medeleffekt och lägsta W′-procent. Ett klick öppnar vyn i §8.3.

### 8.5 Inställningar

- Signatur (manuell inmatning enligt §7.4)
- Standardtolerans för målband och antal drag i effektmedlet
- Gränser för W′-zonerna, samt Skiba-konstanterna under "Avancerat"
- Maskintyp: automatisk eller manuellt val (standard SkiErg)
- Debugläge som loggar rå PM5-data (finns tills vidare som panelen "Felsökning" på startsidan)
- Export och import av hela databasen som JSON

---

## 9. PM5

**Källor:** `demo/` (fungerar mot en riktig PM5), Concept2:s "PM CSAFE Communication Definition" och "PM5 Bluetooth Smart Communications Interface Definition", samt ErgometerJS i `reference/`.

**Märkning:** **[BEKRÄFTAT]** = fungerar mot en riktig PM5, i appen eller i `demo/`. **[VERIFIERA]** = ej bekräftat.

### 9.1 USB (WebHID + CSAFE) – standard [BEKRÄFTAT]

Bekräftat 2026-09-24: appen ansluter via USB och effekten per drag stämmer med PM5-displayen.

- **Enhet:** `navigator.hid.requestDevice` med `vendorId: 0x17A4`. Därefter hittas enheten med `navigator.hid.getDevices()` utan klick.
- **HID-rapporter:** PM:en svarar i samma rapport som frågan skickades i, och klipper svar som inte får plats. Prova med `GETSTATUS` (0x80) i ordningen #2 (120 B), #4 (62 B), #1 (20 B) och behåll den första som svarar. Fyll ut varje rapport till den storlek HID-deskriptorn anger om den är större. Windows kräver det och anger 500 B för alla tre.
- **Ram:** `F1 <innehåll> <XOR-checksumma> F2`. Bytes F0–F3 i innehåll och checksumma byte-stuffas som `F3 00..03`. Svaret kommer i en rapport. Klipp vid första `F2`, eftersom gammalt skräp kan följa efter.
- **Svar:** statusbyte, sedan `[kommando, längd, data…]*`. PM-kommandon ligger i wrappern `0x1A` och tolkas för sig, eftersom kommandokoderna överlappar med standardkommandona.
- **Pollning** (ingen notifiering finns över USB):
  - Var 50:e ms: `GETPOWER` (0xB4) + PM `STROKESTATE` (0xBF).
  - Var 250:e ms: `GETPACE` (0xA6, s/km), `GETCADENCE` (0xA7), `GETPOWER`, `GETHRCUR` (0xB0) + PM `WORKTIME` (0xA0, 0,01 s), `WORKDISTANCE` (0xA3, 0,1 m), `STROKESTATE`, `DRAGFACTOR` (0xC1).
  - Standardsvaren är little-endian följt av en enhetsbyte.
- **Drag:** ett drag räknas när dragfasen lämnar "driving" (2). Effekten tas från `GETPOWER` i *nästa* svar, när PM:en har hunnit uppdatera den.
- **Återanslutning:** efter 10 fel i rad, eller när sladden dras ur, försöker appen igen var 2:a sekund tills PM:en svarar eller användaren kopplar från. Passet fortsätter under tiden, och luckan markeras i datan.
- **Maskintyp:** finns inte över CSAFE. Det manuella valet i inställningarna gäller (standard SkiErg).

### 9.2 Web Bluetooth – alternativ

- **Anslutning [BEKRÄFTAT i demo/]:** `navigator.bluetooth.requestDevice` med filtret `services: [ce060000-…]` (discovery-tjänsten), inte namnet, eftersom namnet kan saknas i annonsen på Windows. Anropet måste ske från ett användarklick. Som reserv finns "Visa alla enheter" (`acceptAllDevices`).
- **Maskintyp [BEKRÄFTAT i demo/]:** läses från `0016` i device info-tjänsten (1 byte). SkiErg = 128. Andra värden ger det manuella valet.
- **Dragdata [BEKRÄFTAT i demo/]:** notifications på `0036`. Om den inte går att prenumerera på används multiplexade `0080`, där byte 0 är id (0x36) och resten har samma layout som `0036`.
- **Övrigt [VERIFIERA]:** samplingsintervall till `0034` (3 = 100 ms) och notifications på `0031`, `0032`, `0033` och `0035`. Dessa är valfria. Anslutningen lyckas även om de misslyckas.
- **Återanslutning:** vid `gattserverdisconnected` görs upp till 5 försök med ökande väntetid. Passet fortsätter under tiden, och luckan markeras i datan.
- **Puls [VERIFIERA]:** från `0032` om värdet är giltigt (skilt från 255). Separat pulsband kommer i v2.

UUID-bas: `ce06XXXX-43e5-11e4-916c-0800200c9a66`

| XXXX | Namn | Används till i v1 | Status |
|---|---|---|---|
| 0000 | Discovery service | filter i `requestDevice` | BEKRÄFTAT (demo) |
| 0010 | Device information service | behållare för 0016 | BEKRÄFTAT (demo) |
| 0016 | Erg machine type | maskintyp, SkiErg = 128 | BEKRÄFTAT (demo) |
| 0020 | Control service | används inte | – |
| 0030 | Rowing service (primär) | behållare för nedanstående | BEKRÄFTAT (demo) |
| 0031 | General status | elapsed time, distans, workout state, drag factor | VERIFIERA |
| 0032 | Additional status | dragtakt, puls, pace | VERIFIERA |
| 0033 | Additional status 2 | medeleffekt (kontrollvärde) | VERIFIERA |
| 0034 | Sample rate (write) | 0 = 1 s, 1 = 500 ms, 2 = 250 ms, 3 = 100 ms | VERIFIERA |
| 0035 | Stroke data | tolkade fält sparas i `raw` | VERIFIERA |
| 0036 | Additional stroke data | **effekt per drag (W)**, antal drag | BEKRÄFTAT (demo), byte 0–8 |
| 003D | Force curve | används inte (v2) | – |
| 0080 | Multiplexed data | reserv för 0036 | BEKRÄFTAT (demo) |

### 9.3 Byte-layouter för Bluetooth

Alla värden är little-endian. Tid anges i enheter om 0,01 s och distans i enheter om 0,1 m.

- **0036 [BEKRÄFTAT i demo/, byte 0–8]:** [0–2] elapsed, [3–4] effekt per drag (W), [5–6] stroke calories (cal/h), [7–8] antal drag. [VERIFIERA]: [9–11] projected work time, [12–14] projected work distance. De saknas i den multiplexade varianten.
- **0031 [VERIFIERA]:** [0–2] elapsed, [3–5] distans, [6] workout type, [7] interval type, [8] workout state, [9] rowing state, [10] stroke state, [11–13] total work distance, [14–16] workout duration, [17] duration type, [18] drag factor
- **0032 [VERIFIERA]:** [0–2] elapsed, [3–4] speed (0,001 m/s), [5] dragtakt, [6] puls (255 = ogiltig), [7–8] current pace (0,01 s/500 m), [9–10] average pace, [11–12] rest distance, [13–15] rest time. Maskintypen läses från `0016`, inte från här.

**Tolkning:** Parse-funktionerna (Bluetooth: `DataView → objekt`, USB: CSAFE-ram → svar) är rena funktioner med enhetstester. Hex-fixtures från en riktig PM5 läggs i `tests/fixtures/` och spelas upp av `tests/fixtures.test.ts`.

---

## 10. Simulator

Simulatorn implementerar `DataSource` och används med `SimClock`.

- **Status:** skickas var 100:e ms. **Drag:** skickas ett i taget, i takt med dragtakten.
- **Dragtakt:** `clamp(28 + 0,06 · p, 25, 60)` drag/min, plus brus.
- **Effekt per drag:** läget ger ett grundvärde som multipliceras med `(1 + N(0; 0,07))`.

**Lägen:**

- **`followTarget`:** Följer passets mål. Varje drag har 5 % sannolikhet att avvika ±20 %.
- **`manual`:** Piltangenterna ändrar effekten ±10 W, och mellanslag betyder att användaren slutar dra.
- **`fatigue`:** Simulatorn har en egen "sann" signatur och en egen W′-balans. Den kan aldrig ge mer effekt än sin egen MPA. I testsegment (`max`) ger den sin sanna modells P(t) plus brus. Standardvärden för den sanna signaturen: PP 550 W, CP 220 W, W′ 18 000 J.

**Tidsacceleration:** 1×, 5× och 20×.

---

## 11. Lagring

IndexedDB-databasen heter `skierg-training`, version 1.

| Store | Innehåll | Nyckel och index |
|---|---|---|
| `sessions` | `{ id, startedAt, machine, mode: 'workout' \| 'test' \| 'free', workoutId?, timeline, signatureId, signatureSnapshot, status: 'completed' \| 'aborted', summary }` | `id`, index på `startedAt` |
| `chunks` | `{ sessionId, seq, strokes: StrokeSample[], status: StatusSample[], rawLog?: string[] }` | `[sessionId, seq]` |
| `signatures` | `FitnessSignature` | `id`, index på `machine` |
| `testResults` | `TestResult` | `id`, index på `[machine, duration]` |
| `settings` | nyckel–värde | `key` |

- **Autosparning:** Recordern skriver en chunk var 30:e sekund, så att högst 30 s data går förlorad om webbläsaren kraschar.
- **Rådata först:** Spara alla tolkade fält per drag, även sådana som v1 inte använder. v2 ska kunna räkna fram trender och belastning bakåt i tiden.
- **Inga härledda serier:** 1 Hz-effekt och W′-kurva räknas om från rådata när de behövs. `summary` får innehålla färdiga sammanfattningsvärden.
- **Tidslinje och signatur:** Varje pass sparar en kopia av sin expanderade tidslinje och av den signatur som användes, så att gamla pass kan visas korrekt även efter att signaturen ändrats.

---

## 12. Byggordning och acceptanskriterier

### Steg 0 – Verifiera protokollet

Kräver en riktig PM5. Agenten bygger loggningen, användaren kör den mot sin SkiErg och lämnar tillbaka loggen.

- **Bygg:** Panelen "Felsökning" på startsidan (§8.1). Den loggar rå hex från PM5 (USB eller Bluetooth) bredvid de tolkade dragen, och loggen kan laddas ned som JSON.
- **Klart när:**
  - effekten per drag stämmer med PM5-displayen (±2 W) för 20 drag i följd – **klart för USB** (2026-09-24),
  - dragtakten stämmer,
  - hex-fixtures ligger sparade i `tests/fixtures/` och `tests/fixtures.test.ts` är grönt,
  - §9 är uppdaterad med verifierade värden och märkningen [VERIFIERA] är borttagen där det gäller – **klart för USB och det som `demo/` bekräftar för Bluetooth**.

Om steg 0 inte kan göras direkt får agenten fortsätta med steg 1 mot simulatorn. PM5-tolkningen förblir då märkt som overifierad.

### Steg 1 – Grund

**Status: klart** (2026-09-24). Simulatorläget `fatigue` är flyttat till steg 3, som är det enda steget som använder det.

- **Bygg:** Projektuppsättning, `Clock`, event-buss, `DataSource`, simulatorn (§10), PM5-källan (§9), recordern med autosparning, IndexedDB (§11) och en enkel historiklista.
- **Klart när:**
  - det går att ansluta (PM5 eller simulator), starta fri åkning, stoppa och se passet i historiken,
  - en omladdning av sidan mitt i ett pass förlorar högst 30 s data,
  - enhetstesterna för parse-funktionerna är gröna.

### Steg 2 – Livevyn

- **Bygg:** `resample`, `wbal` och `mpa` med tester (§5.4–5.6), `schema`, `expand` och `runner` med tester (§6), de inbyggda passen, livevyn i Canvas med sidopanel (§8.2), Wake Lock och pip vid segmentbyte.
- **Klart när:**
  - 4×4-passet i simulatorn på 20× visar målband, effekt och MPA som rullar synkront,
  - W′-batteriet sjunker under intervallerna och återhämtar sig under vilorna,
  - färgerna byter vid rätt gränser,
  - vyn håller 30 fps på en vanlig laptop,
  - referenstesterna i §5.5 och §6.2 är gröna.

### Steg 3 – Test och signatur

- **Bygg:** Manuell signatur, de tre testpassen och testläget (§7), `fit3p` med tester (§5.3), flödet för att godkänna en ny signatur, resultatvyn, vyn efter passet (§8.3) och JSON-backup.
- **Klart när:**
  - de tre testen körda i simulatorn (`fatigue`, sann signatur 550/220/18 000) ger en anpassad signatur med CP inom ±3 % och W′ inom ±10 % av de sanna värdena,
  - livevyn använder den nya signaturen direkt efter godkännande,
  - referenstestet i §5.3 är grönt,
  - en export följd av import i en tom databas återskapar alla pass.

---

## 13. Kända risker och öppna frågor

- **Skiba-konstanterna** kommer från cykling och kan skilja sig för stakning. De är konfigurerbara, och kalibrering sker i v2.
- **Toleransbandet** på ±5 % är en gissning. Justera efter riktig data.
- **Effekten per drag** på SkiErg är ryckig. Medel över 3 drag är ett startvärde.
- **Maskintyp:** över Bluetooth läses den från `0016` (SkiErg = 128). Över USB finns den inte, så där gäller det manuella valet (§9).
- **WebHID och Web Bluetooth** fungerar inte i iOS, kräver HTTPS eller `localhost` och kräver ett användarklick första gången.
- **USB-pollning:** status kommer var 250:e ms i stället för var 100:e ms som över Bluetooth. Det räcker för 1 Hz-resamplingen (§5.4).
- **Negativ W′-balans** loggas men hanteras inte i v1. Breakthrough-logiken kommer i v2.