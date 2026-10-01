# SkiErg Training – Spec v1

> **Till kodagenten.** Det här dokumentet beskriver version 1 av appen. Det ersätter tidigare `AGENTS.md` och Roadmap (50 steg). Begreppen FTP, TSS och MSS från de gamla dokumenten används inte längre.
> Allt som listas under §2.2 *Utanför scope* ska **inte** byggas nu, inte heller i förenklad form.

---

## 0. Arbetsregler

- **Ordning:** Bygg i den ordning som anges i §12 (steg 0–4) och därefter i `plan.md` §7. Ett steg i taget. Varje steg ska uppfylla sina acceptanskriterier innan nästa påbörjas.
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
- Fitness Signature per maskintyp: manuell inmatning samt ett testbatteri med fyra test och kurvanpassning
- Vy efter passet och en enkel historiklista
- Backup av databasen som JSON (export och import)

### 2.2 Utanför scope – bygg inte

Arbetet efter v1 står i [`plan.md`](plan.md) (beslut 2026-09-29). Där står också gränsen mot elitledet, som är coachen.

**Planeras efter v1** (se `plan.md` §6 och §7):

- Breakthroughs inom ett pass
- Separat pulsband
- Kraftkurva per drag
- PWA och offline-läge
- FIT-export, bara om passen ska till Garmin eller Strava

**Hör till elitledet – bygg inte här:** signaturens nedgång över veckor, Low/High/Peak Load, HRR30/HRR60-analys, Form Check och träningsrekommendationer, import från Concept2 Logbook, passgenerator och maskininlärning, ATL/CTL per energisystem.

**Struket:** gamification och passeditor i gränssnittet (ersätts av import av planerade pass, `plan.md` §4.1).

**Senare eller aldrig:**

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
  workout/     schema.ts, expand.ts, runner.ts, plan.ts, builtin/*.json
  session/     recorder.ts, summary.ts
  storage/     db.ts, backup.ts
  ui/          views/ (start, workouts, workout, live, session, history, settings)
               live/canvas.ts, gauge.ts, maxChart.ts
               strip.ts, components.ts, icons.ts
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
- **Simulerade signaturer:** En signatur som anpassats från simulatortest får `simulated: true` och används bara med simulatorn, aldrig för en riktig PM5. Samma sak gäller testresultat (§7.3). Så kan simulatortest inte påverka den riktiga signaturen.
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
3. Returnera `{ cp, wPrime, k, pp: cp + wPrime / k, sse, residuals }`, där `residuals` är uppmätt minus modellerad effekt per punkt, i watt.

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
annars:      D    = CP − p
             τ    = enligt vald modell (nedan)
             wbal = W′ − (W′ − wbal) · e^(−Δt / τ)
```

**Återhämtningsmodell** (användarens beslut 2026-09-24, valbar under Inställningar → Avancerat):

| Modell | τ | Kommentar |
|---|---|---|
| **Skiba 2015** (standard) | `W′ / D` | Differentiell modell. Inga konstanter från cykling, skalar med användarens egen W′. |
| Skiba 2012 | `546 · e^(−0,01 · D) + 316` | Den ursprungliga formeln i spec:en. Konstanterna kommer från cykling och är konfigurerbara. τ ≥ 316 s gör återhämtningen mycket långsam: från 50 % till 90 % tar det cirka 11 min vid vila med CP 180 och W′ 10 000. |
| Bartram 2018 | `2287,2 · D^(−0,688)` | Anpassad till elitcyklister. |

Förbrukningen över CP är densamma i alla modeller. Med Skiba 2015 och Bartram 2018 blir τ oändligt vid D = 0, så det sker ingen återhämtning exakt på CP.

- **Negativt värde:** `wbal` får bli negativ. Den lagras som den är, men visas som 0 % med markeringen "över modellen". Hantering av breakthroughs kommer i v2.
- **Tid till tomt** vid aktuell effekt p > CP: `max(wbal, 0) / (p − CP)`.

**Referenstester för Skiba 2012** (verifierade numeriskt):

| Scenario | Förväntat |
|---|---|
| CP 250, p = 0 W | τ ≈ 360,8 s |
| CP 250, p = 200 W | τ ≈ 647,2 s |
| W′ 20 000 J, CP 250: 60 s på 350 W | wbal = 14 000 J |
| …följt av 60 s på 0 W | wbal ≈ 14 919 J |

**Referenstest för Skiba 2015:** samma scenario ger 14 000 J och sedan 20 000 − 6 000 · e^(−0,75) ≈ 17 166 J.

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
- **`kind`** är ett av: `warmup`, `interval`, `rest`, `steady`, `cooldown`, `test`, eller `block` (nedan).
- **`label`** (valfri per segment): namn som visas i stället för namnet på `kind`, till exempel "Ökning".
- **`description`** (valfri på passet, segmentet, blocket och vilan): fritext till atleten. Livevyn visar segmentets beskrivning, annars närmaste blocks. Före start och i ett pass utan segment visas passets.
- **`repeat` och `rest`:** Vilan läggs *mellan* repetitionerna, inte efter den sista.
- **`tolerance`** (valfri per segment): relativ andel av målet. Standard ±5 % [FÖRSLAG].
- **Block** (tillagt i steg 5, `plan.md` §4.1): `{ "kind": "block", "label"?, "description"?, "repeat"?, "rest"?, "segments": [...] }` grupperar segment, till exempel uppvärmningen, och kan upprepas: 3 × (10 × 40/20) skrivs som ett block med `repeat: 3`. Block kan nästlas i högst fyra nivåer. `rest` läggs mellan blockets repetitioner. I tidslinjen får segmenten i ett block `block`, till exempel "Klunga 3/12". Ett block utan `label` som inte upprepas syns inte.
- **Utan `segments`** är passet ostrukturerat. Det körs som fri åkning (§6.4) med passets beskrivning och sparas med `workoutId`. En tom lista är ett fel.
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
  block?: string;                      // omgivande block, t.ex. "Serie 2/3"
  description?: string;                // segmentets beskrivning, annars närmaste blocks
}
```

**Referenstest:** 4×4-exemplet ger 9 segment (uppvärmning, 4 intervaller, 3 vilor, nedvarvning) och total längd 2 220 s. Med CP 200 W blir intervallmålet 210 W och bandet 199,5–220,5 W.

### 6.3 WorkoutRunner

- **Tillstånd:** `idle → countdown (10 s) → running ⇄ paused → finished`. Nedräkningen är 10 s (användarens beslut 2026-09-24), med pip under de tre sista sekunderna.
- **Tidslinjen** följer klockan, inte prestationen.
- **Paus:** Tidslinjen fryses. Datainspelningen fortsätter och markeras som pausad. W′-balansen fortsätter att räknas med effekten från resamplern, så att återhämtningen under pausen blir korrekt.
- **Avbrott:** Om användaren stoppar i förtid sparas passet med status `aborted`.
- **Segmentbyte:** Tre korta pip (Web Audio) under de sista tre sekunderna före nytt segment. [FÖRSLAG]

### 6.4 Inbyggda pass

Träningspassen har ingen uppvärmning eller nedvarvning (användarens beslut 2026-09-24). Värm upp med fri åkning före passet. Testpassen i §7 behåller sina.

1. **4×4 min tröskel:** 4 × 4 min på 105 % CP med 2 min vila på 40 % CP (exemplet i §6.1 utan uppvärmning och nedvarvning).
2. **8×1 min hårt:** 8 × (1 min på 130 % CP / 1 min på 40 % CP).
3. **30 min jämnt:** 30 min på 75 % CP.
4. **2×15 min:** 2 × 15 min på 95 % CP med 3 min vila på 40 % CP.
5. **6×5 min:** 6 × 5 min på 100 % CP med 1 min vila på 40 % CP.
6. **10×3 min:** 10 × 3 min på 105 % CP med 1 min vila på 40 % CP.
7. **3×10 min 40/20:** tre block med 10 × (40 s på 120 % CP / 20 s på 40 % CP) och 3 min vila på 40 % CP mellan blocken. Passet skrevs innan formatet fick block (§6.1), så blocken står var för sig och heter "Block 1 · 3/10" osv. Intensiteter och vilor i pass 4–7 är [FÖRSLAG].
8. **Fri åkning:** Ett eget läge utan tidslinje. Livevyn visar effekt, MPA och W′-batteri men inget målband. Passet pågår tills användaren stoppar.

Testpassen beskrivs i §7.

### 6.5 Anpassning till W′ (användarens beslut 2026-09-24)

Ett pass anpassas till användarens signatur så att den **planerade** W′-balansen inte går under en inställbar lägsta nivå (§8.5, standard 30 %, gränsen till röd zon i §5.7).

- **Planen:** Passet simuleras sekund för sekund med målen och vald W′-modell (§5.5). Ett segment utan mål räknas som 0 W.
- **Vad som justeras:** bara arbete över CP, och bara överskottet: `mål = CP + s · (mål − CP)`. Vilor, arbete på eller under CP och testpass (§7) rörs inte. Målen avrundas till hela watt, och bandet behåller sin relativa bredd. Målen höjs aldrig över PP.
- **Lägen:** `fit` (standard) söker det största s där planerad lägsta W′ ≥ lägsta nivån, så passet landar på nivån, antingen sänkt eller höjt. `lower` sänker bara om passet annars skulle gå under. `off` använder målen som de står.
- **Begränsning:** Planen förutsätter att målet hålls exakt. Drag över målet och ryckiga drag (§13) drar mer W′ än planen räknar med.
- Startsidan visar justerat arbetsmål och beräknad lägsta W′ för det valda passet.
- Planen räknar med ramperna i §6.6.

### 6.6 Ramper runt intervaller (användarens beslut 2026-09-24)

Under de 5 s före en intervall och de 5 s efter den går mål och band linjärt mellan grannsegmentets mål och intervallens. Rampen ligger i grannsegmentet (oftast vilan), så intervallen behåller sitt fulla mål hela tiden. Om grannsegmentet är kortare än två ramper får varje ramp halva längden. Det blir ingen ramp mot passets början eller slut, mellan två intervaller eller där något av segmenten saknar mål. Ramperna gäller livevyn, simulatorns mål, andelen tid inom bandet (§8.3) och W′-planen (§6.5). De räknas fram ur tidslinjen och sparas inte.

### 6.7 Planerade pass (steg 5, `plan.md` §4.1)

elitledet skriver en fil per vecka med `python -m planering` (elitledets `docs/planfiler.md`). Filen importeras från startsidan. Exempelfilen `tests/fixtures/plan/plan-exempel.json` ska vara identisk med elitledets `tests/fixtures/plan-exempel.json`. Förkortat utdrag:

```json
{
  "format": "stakometer-plan",
  "version": 1,
  "athlete": { "maxHR": 188, "thresholdHR": 168, "restingHR": 44, "weight": 82.5,
               "pp": 610, "cp": 215, "wPrime": 16500, "dragFactor": 110, "asOf": "2026-10-04" },
  "workouts": [
    { "id": "2026-10-05-lugnt-teknikpass", "date": "2026-10-05", "name": "Lugnt teknikpass",
      "description": "45–60 min på 60–70 % CP. Fokus på hög höft, vertikal stav och 1 Hz." },
    { "id": "2026-10-06-5x4-min-vo2peak", "date": "2026-10-06", "name": "5×4 min VO2peak",
      "description": "Bromsar VO2max-tappet.",
      "calibration": { "mode": "fit", "minWbal": 0.3 },
      "segments": [
        { "kind": "block", "label": "Uppvärmning", "description": "Lugnt, med två korta ökningar mot slutet.",
          "segments": [
            { "kind": "warmup", "label": "Lugnt", "duration": 480, "target": { "pctCP": 60 } },
            { "kind": "warmup", "label": "Ökning", "duration": 10, "target": { "pctCP": 120 }, "repeat": 2,
              "rest": { "duration": 50, "target": { "pctCP": 60 } } } ] },
        { "kind": "interval", "description": "Jämnt tryck.", "duration": 240, "target": { "pctCP": 108 }, "repeat": 5,
          "rest": { "duration": 180, "target": { "pctCP": 45 }, "description": "Aktiv vila." } },
        { "kind": "cooldown", "description": "Lugnt, valfri teknik.", "duration": 600, "target": null }
      ] }
  ]
}
```

- **Passen** har formatet i §6.1 plus `date` (ÅÅÅÅ-MM-DD) och valfri `calibration`. `id` sparas som `workoutId` på passet, och en kopia av det planerade passet sparas som `planned`, så att elitledet kan koppla ihop planerat och genomfört.
- **`calibration`** `{ "mode": "fit" | "lower" | "off", "minWbal"? }` går före inställningen i §8.5 för just det passet. Utan `minWbal` gäller inställningens.
- **`athlete`** är det coachen visste när planen skrevs. Alla fält är valfria: `maxHR`, `thresholdHR`, `restingHR` (slag/min), `weight` (kg), `pp`, `cp` (W), `wPrime` (J), `dragFactor` och `asOf` (datum). Okända fält ignoreras. Värdena kopieras till varje pass i filen och används så här:
  - Livevyn visar pulsen också i procent av tröskelpulsen, eller av maxpulsen om tröskelpulsen saknas.
  - Startsidan varnar när planens CP skiljer mer än 3 % eller W′ mer än 10 % från den aktiva signaturen [FÖRSLAG]. Watten räknas alltid från den aktiva signaturen. Är den aktiva signaturen standardvärden för PM5 (§5.1) och planen har PP, CP och W′ kan de sparas som manuell signatur med en knapp. Med simulatorn jämförs inget.
  - Livevyn varnar under de första 3 minuterna om dragfaktorn skiljer mer än 5 från planens [FÖRSLAG]. I ett testpass gäller förra testet med samma längd i första hand (§7.3).
- **Import:** hela filen valideras först. Ett fel ger ett begripligt meddelande, och inget importeras. Ett pass med samma `id` som ett tidigare importerat ersätts.
- **Startsidan** listar planerade pass först: dagens, sedan kommande efter datum, sedan den senaste veckans. Äldre ligger kvar i databasen och backupen men visas inte. Ett genomfört pass markeras med ✓. Det valda passet visas med beskrivning, struktur, anpassning och atletens värden, och kan tas bort från listan.

---

## 7. Testbatteri

### 7.1 Testpassen

Testbatteriet har fyra separata testpass: `test-30s`, `test-180s`, `test-360s` och `test-720s` (beslut 2026-09-29, `plan.md` §3). Alla har samma upplägg:

1. 10 min uppvärmning på 55 % CP, med 2 × 10 s ökningar på 120 % CP mot slutet (vid 8:00 och 9:00) [FÖRSLAG]
2. 3 min lätt
3. Maxinsatsen (`target: { "max": true }`)
4. 5 min nedvarvning

UI-texten ska rekommendera att alla fyra görs inom 14 dagar med samma dragfaktor, högst två samma dag med minst 30 min lugnt emellan, till exempel 12 min dag 1, 30 s och 3 min dag 2 och 6 min dag 3.

### 7.2 Testläge

- Inga varningar för W′ under maxinsatsen.
- Under maxinsatsen byter livevyn till en egen skärm: texten "MAX", stor nedräkning, löpande medeleffekt, aktuell effekt och dragtakt, en graf över insatsen från start till slut med snittet och förra testet med samma längd, och knappen "Avbryt test".
- Före maxinsatsen visas en varning om dragfaktorn skiljer sig från förra testet med samma längd (§7.3), så att dämparen hinner ställas om under uppvärmningen.

### 7.3 Resultat

- **Testresultat:** medeleffekten under maxsegmentet, räknad från den 1 Hz-resamplade effekten. Sparas som `TestResult { id, sessionId, machine, duration, avgPower, date, dragFactor? }`. `dragFactor` är medianen av dragfaktorn för dragen i maxinsatsen och saknas om källan inte ger någon.
- **Förslag på ny signatur:** Appen tar det senaste resultatet för varje längd i batteriet, och av dem de som ligger inom 14 dagar från det nyaste. Finns minst tre olika längder kvar kör appen `fit3p` och föreslår en ny signatur. Användaren godkänner eller avböjer. Annars listar appen vilka längder som saknas. Simulerade och riktiga resultat blandas aldrig.
- **Residual:** Med fyra test visar resultatvyn avvikelsen per test (uppmätt minus kurvan), SSE och största avvikelse i watt. Med tre test går kurvan genom alla punkterna, och vyn säger det i stället för att visa en residual.
- **Dragfaktor:** Två dragfaktorer räknas som olika om de skiljer mer än 5 (`DRAG_FACTOR_TOLERANCE`) [FÖRSLAG]. Startsidan visar förra resultatet och dess dragfaktor när ett testpass väljs. Livevyn varnar före maxinsatsen (§7.2), och vyn efter passet varnar om testet avviker från förra testet med samma längd eller om testen i förslaget har olika dragfaktor.
- **Jämförelse med signaturen:** Efter ett test visas vad signaturen i passet gav för testets längd och hur många procent resultatet avviker. Så går ett kontrolltest mellan batterierna (`plan.md` §3) att läsa av. Jämförelsen visas inte när passet använde standardvärdena (§5.1).
- **Var:** Förslaget och resultatvyn visas i vyn efter passet (§8.3) för ett testpass.
- **Resultatvy:** Punkterna med den anpassade kurvan för 10 s till 30 min (logaritmisk x-axel), och en tabell med datum, resultat, kurvans värde, avvikelse och dragfaktor per test. Den tidigare signaturens kurva visas streckad som jämförelse.

### 7.4 Manuell signatur

Under inställningar kan användaren mata in PP, CP och W′ direkt, med validering enligt §5.1.

---

## 8. Vyer

**Gemensamt för alla vyer:** mörkt tema som standard och stor typografi, eftersom siffrorna ska gå att läsa på 2–3 meters avstånd. Screen Wake Lock hålls aktivt under pass, och det finns en knapp för helskärm.

**Utseende** (användarens skiss 2026-10-01): mörkblå bakgrund och kort med rundade hörn. Blått markerar det valda och det pågående, grönt startar och godkänner, rött betyder MAX och avbrott. Rubrikraden har en pil tillbaka till vänster, och livevyn och resultatvyerna visar klockan till höger. Ikonerna är egna SVG-linjer, inget ikonbibliotek.

### 8.1 Start

- **Rubrikrad:** "Stakometer", anslutningsstatus (till exempel "● PM5 ansluten") och ett kugghjul till inställningarna. Ett klick på statusen visar anslutningen, med "Koppla från".
- **Anslutning:** När inget är anslutet visas knapparna "Anslut PM5 via USB", "Anslut via Bluetooth" och "Använd simulator", och simulatorns hastighet, läge och dragfaktor.
- **Dagens pass** står överst i blått: dagens första planerade pass som inte är gjort, annars nästa planerade pass.
- **Rader** med ikon, rubrik och en rad text: Planerade pass (antal denna vecka), Inbyggda pass, Maxtest, Fri åkning, Historik (antal pass), Fitness Signature (aktiv signatur; standardvärden (§5.1) visas som sådana, med en uppmaning att göra test eller mata in egna), Importera planfil (§6.7) och Säkerhetskopiera data (export, §11; import under inställningar).
- **Listorna:** Planerade pass med dag och ✓ för genomförda, de inbyggda passen med struktur, och testpassen med förra resultatet och dess dragfaktor (§7.3) och råden för testbatteriet (§7.1).
- **Passvyn** visar det valda passet före start: längd, en remsa med passets delar (§8.2), struktur och beskrivning, anpassning till W′ (§6.5), förra testet med samma längd, atletens värden och varningar från planen (§6.7) och startknappen. När inget är anslutet visas anslutningen ovanför.
- Panelen "Felsökning" ligger under inställningarna (§8.5).

### 8.2 Livevy

**Rubrikrad:** anslutningsprick, passets namn och pågående segment (till exempel "Block 1 · 2/10 – 0:40"), knappar för ljud, paus, helskärm och avsluta, och klockan.

**Remsa** under rubriken: en ruta per del av passet (steget på översta nivån), bredd efter längd, med namn, struktur och en liten profil av målen. Uppvärmnings- eller nedvarvningssegment i följd slås ihop, så testens uppvärmning blir "Uppvärmning 10:00". Den pågående delen är blå, med en markering för var i delen passet är.

**Canvas (cirka 70 % av ytan):**

- **Teckenförklaring** ovanför: "Effekt (W)", Effekt (3 drag), Målband, MPA och CP.
- **X-axel:** från t − 60 s till t + 60 s, med en lodrät "nu"-linje i mitten. Vyn rullar mjukt.
- **Y-axel:** fast skala per pass, från 0 till `max(högsta målet i passet × 1,4, CP × 1,5)`. Om MPA-linjen hamnar ovanför skalan ritas den i överkant med en pil och en etikett med värdet.
- **Målband:** blå fylld yta och mållinje, både bakåt och framåt i tiden.
- **Effekt:** medelvärdet av de 3 senaste dragen (antalet konfigurerbart). Linjen är grön inom bandet, orange under och röd över.
- **MPA:** gul streckad linje.
- **CP:** grå streckad referenslinje.
- **Segmentgränser:** lodräta linjer med etiketter framåt, till exempel "Vila 2:00".

**Under grafen:** tid (med passets längd), distans, medeleffekt och arbete i kJ, räknade som sammanfattningen i §8.3.

**Sidopanel:**

- W′-mätare: en cirkelbåge fylld till W′-balansen i färgen enligt §5.7, med markeringar vid zongränserna, procent och kJ kvar av W′. Under den MPA, eller "Avsluta intervallet" i röd zon och "Över modellen" under noll.
- Effekt (3-dragsmedel), dragtakt, puls om den finns (med procent av tröskel- eller maxpuls från planen)
- Tid kvar i segmentet och nästa segment med mål
- Tid till tomt W′, om effekten ligger över CP

**Rutor ovanpå:**

- **Nedräkning:** stor siffra och passets första segment.
- **Paus:** pausens längd, texten att tidslinjen står still men W′-balansen räknar vidare, och knapparna "Fortsätt" och "Avsluta pass".
- **Inför ett hårt segment** (intervall, maxinsats eller mål över CP) visas de sista 10 s [FÖRSLAG] av segmentet före ett kort över grafens vänstra halva, så att målbandet framåt syns: segmentet, nästa segment och dess mål, förlopp, ljudknapp och nedräkning.
- **Maxinsatsen** har en egen skärm (§7.2).

**Prestanda:** Rita med `requestAnimationFrame`. Vyn ska hålla 30 fps utan hack.

### 8.3 Efter passet

- **Rubrik:** passets namn, datum, tid, distans, källa och status.
- **Graf för hela passet (uPlot):** målband (blått), effekt i 1 Hz (grönt) och W′-balans på en högeraxel (gult).
- **Sammanfattning:** tid, distans, medeleffekt, arbete i kJ, lägsta W′ (procent och när), snittpuls (med procent av tröskel- eller maxpuls från planen), dragtakt och dragfaktor (median).
- **Tabell per intervall:** intervallerna och maxinsatsen, eller alla segment med mål om passet saknar intervaller. Mål, medeleffekt, andel tid inom bandet och lägsta W′.
- **Testpass:** "Testresultat och kurvanpassning" med resultatet, jämförelsen med signaturen, dragfaktorn, föreslagen signatur med skillnaden mot nuvarande, residual, "Godkänn" och "Avböj", och grafen och tabellen i §7.3.

### 8.4 Historik

En lista med datum, pass, tid, distans, medeleffekt och lägsta W′-procent. Ett klick öppnar vyn i §8.3.

### 8.5 Inställningar

- Signatur (manuell inmatning enligt §7.4)
- Standardtolerans för målband och antal drag i effektmedlet
- Anpassning av passen till W′ (§6.5): läge och lägsta W′
- Gränser för W′-zonerna, W′-modellen (§5.5) och Skiba 2012-konstanterna under "Avancerat"
- Maskintyp: automatisk eller manuellt val (standard SkiErg)
- Panelen "Felsökning", som loggar rå PM5-data (§12 steg 0)
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

**Ökad effekt:** När den önskade effekten ökar med mer än 20 % (t.ex. vid starten av en maxinsats) blir draget som pågår kortare och får den nya dragtakten, i stället för att det långsamma draget först avslutas. Tidigaste slut är 0,6 s. Utan det här kommer första hårda draget upp till 1,8 s in i insatsen, och resultatet för 30 s-testet blir för lågt.

**Dragfaktor:** Varje drag har `raw.dragFactor`, standard 110. Den ställs in på startsidan innan simulatorn ansluts, så att varningarna i §7.3 går att prova.

**Tidsacceleration:** 1×, 5× och 20×.

---

## 11. Lagring

IndexedDB-databasen heter `skierg-training`, version 2 (version 2 lade till `plannedWorkouts`).

| Store | Innehåll | Nyckel och index |
|---|---|---|
| `sessions` | `{ id, startedAt, machine, mode: 'workout' \| 'test' \| 'free', workoutId?, planned?, timeline, signatureId, signatureSnapshot, status: 'completed' \| 'aborted', summary }` | `id`, index på `startedAt` |
| `chunks` | `{ sessionId, seq, strokes: StrokeSample[], status: StatusSample[], rawLog?: string[] }` | `[sessionId, seq]` |
| `signatures` | `FitnessSignature` | `id`, index på `machine` |
| `testResults` | `TestResult` (`{ id, sessionId, machine, duration, avgPower, date, dragFactor?, simulated? }`) | `id`, index på `[machine, duration]` |
| `settings` | nyckel–värde | `key` |
| `plannedWorkouts` | planerade pass från elitledet (§6.7) med `athlete` och `importedAt` | `id`, index på `date` |

- **Autosparning:** Recordern skriver en chunk var 30:e sekund, så att högst 30 s data går förlorad om webbläsaren kraschar.
- **Rådata först:** Spara alla tolkade fält per drag, även sådana som v1 inte använder. v2 ska kunna räkna fram trender och belastning bakåt i tiden.
- **Inga härledda serier:** 1 Hz-effekt och W′-kurva räknas om från rådata när de behövs. `summary` får innehålla färdiga sammanfattningsvärden.
- **Tidslinje och signatur:** Varje pass sparar en kopia av sin expanderade tidslinje och av den signatur som användes, så att gamla pass kan visas korrekt även efter att signaturen ändrats.
- **Backup:** `plannedWorkouts` följer med. En backup från version 1 av databasen saknar den och går ändå att importera.

---

## 12. Byggordning och acceptanskriterier

### Steg 0 – Verifiera protokollet

Kräver en riktig PM5. Agenten bygger loggningen, användaren kör den mot sin SkiErg och lämnar tillbaka loggen.

- **Bygg:** Panelen "Felsökning" (sedan 2026-10-01 under inställningarna, §8.5). Den loggar rå hex från PM5 (USB eller Bluetooth) bredvid de tolkade dragen, och loggen kan laddas ned som JSON.
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

**Status: klart** (2026-09-24).

- **Bygg:** `resample`, `wbal` och `mpa` med tester (§5.4–5.6), `schema`, `expand` och `runner` med tester (§6), de inbyggda passen, livevyn i Canvas med sidopanel (§8.2), Wake Lock och pip vid segmentbyte.
- **Klart när:**
  - 4×4-passet i simulatorn på 20× visar målband, effekt och MPA som rullar synkront,
  - W′-batteriet sjunker under intervallerna och återhämtar sig under vilorna,
  - färgerna byter vid rätt gränser,
  - vyn håller 30 fps på en vanlig laptop,
  - referenstesterna i §5.5 och §6.2 är gröna.

### Steg 3 – Test och signatur

**Kommentar till första kriteriet:** Utfallet är statistiskt. Mätt över 16 slumpfrön (2026-09-24, W′-modell Skiba 2015) ligger CP alltid inom ±2 %, men W′ ligger inom ±10 % i bara 12 av 16. Med 7 % brus per drag (§10) och tre parametrar anpassade till exakt tre punkter flyttar några watt i 30 s- eller 3 min-resultatet W′ med 10 %. Testet för kedjan ersattes i steg 4 av `tests/step4-acceptance.test.ts`.

- **Bygg:** Manuell signatur, de tre testpassen och testläget (§7), `fit3p` med tester (§5.3), flödet för att godkänna en ny signatur, resultatvyn, vyn efter passet (§8.3) och JSON-backup.
- **Klart när:**
  - de tre testen körda i simulatorn (`fatigue`, sann signatur 550/220/18 000) ger en anpassad signatur med CP inom ±3 % och W′ inom ±10 % av de sanna värdena,
  - livevyn använder den nya signaturen direkt efter godkännande,
  - referenstestet i §5.3 är grönt,
  - en export följd av import i en tom databas återskapar alla pass.

### Steg 4 – Testbatteriet

**Status: klart** (2026-09-29). Bakgrunden står i `plan.md` §3, och steg 5–7 i `plan.md` §7.

**Kommentar till första kriteriet:** Mätt över 16 slumpfrön (2026-09-29, W′-modell Skiba 2015) ligger CP alltid inom ±2 % och W′ inom ±10 % i 14 av 16, mot 12 av 16 med de tidigare testen 30 s, 3 min och 10 min. Simulatorns maxinsats följer dess sanna modell exakt, så residualen blir under 2 W. `tests/step4-acceptance.test.ts` kör kedjan med fasta frön.

- **Bygg:** Testpassen `test-360s` och `test-720s` i stället för `test-600s`, förslag från minst tre längder inom 14 dagar, residual i `fit3p` och i resultatvyn, dragfaktor i `TestResult` med varningar (§7).
- **Klart när:**
  - fyra test i simulatorn (`fatigue`, sann signatur 550/220/18 000) ger CP inom ±3 % och W′ inom ±10 % av de sanna värdena,
  - residualen visas,
  - varningen för dragfaktorn syns när den ändras (simulatorns dragfaktor ställs in på startsidan, §10).

---

## 13. Kända risker och öppna frågor

- **W′-återhämtningen** är inte kalibrerad för stakning. Standardmodellen är Skiba 2015 (§5.5), och kalibrering sker i v2.
- **Toleransbandet** på ±5 % är en gissning. Justera efter riktig data.
- **Effekten per drag** på SkiErg är ryckig. Medel över 3 drag är ett startvärde.
- **Maskintyp:** över Bluetooth läses den från `0016` (SkiErg = 128). Över USB finns den inte, så där gäller det manuella valet (§9).
- **WebHID och Web Bluetooth** fungerar inte i iOS, kräver HTTPS eller `localhost` och kräver ett användarklick första gången.
- **USB-pollning:** status kommer var 250:e ms i stället för var 100:e ms som över Bluetooth. Det räcker för 1 Hz-resamplingen (§5.4).
- **Negativ W′-balans** loggas men hanteras inte i v1. Breakthrough-logiken kommer i v2.