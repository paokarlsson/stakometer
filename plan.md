# Stakometer – plan efter v1

29 september 2026. Beskriver vad stakometer ska göra efter steg 3 i `spec.md` §12, och gränsen mot [elitledet](https://github.com/paokarlsson/elitledet), som är coachen. Samma beslut står i elitledets `plan.md`. Ändras något här ska det ändras där också.

## 1. Rollerna

- **stakometer är instrumentet vid maskinen.** Den kör passet, mäter och sparar allt PM5 ger. Den ser ett pass i taget.
- **elitledet är coachen.** Den ser hela säsongen, all träning och dygnsdata från Garmin. Den bestämmer vad som ska göras.

De möts bara i SkiErg-passet: elitledet skickar vad som ska göras (§4.1), stakometer skickar tillbaka vad som blev gjort (§4.2).

| | stakometer | elitledet |
|---|---|---|
| Watt i passet: % av CP räknas om med signaturen och W′-anpassningen | ✔ | |
| Rådata per drag: effekt, dragtakt, dragfaktor, puls och det PM5 i övrigt ger | ✔ | |
| Utfall per pass: medeleffekt, arbete, lägsta W′, andel tid i bandet | ✔ | |
| Hur ett test räknas till PP, CP och W′ (§3) | ✔ | |
| Breakthroughs inom ett pass (W′-balansen under noll) | ✔ | |
| Säsong, block, vecka och vad varje pass innehåller | | ✔ |
| Vilka tester som görs och när | | ✔ |
| Belastning, effektkurva, pulsdrift och HRR över tid | | ✔ |
| HRV, vilopuls, sömn och annan träning än SkiErg | | ✔ |
| RPE och kommentar efter passet | | ✔ |

**stakometer ska inte** planera, visa kalender eller dagsform, rekommendera pass, räkna belastning över veckor eller ta emot annan träning än SkiErg.

## 2. Beslut 2026-09-29

1. **Testbatteri:** 30 s, 3 min, 6 min och 12 min, anpassade med `fit3p` (§3). Ersätter 30 s, 3 min och 10 min.
2. **Samma modell i båda apparna:** Mortons treparametersmodell (spec §5.2) och W′-balans enligt Skiba 2015 (spec §5.5). Modellen definieras här i `spec.md` §5. elitledet använder samma formler och samma referenstester. Byts modellen ska elitledet ändras i samma veva.
3. **Intensiteten över CP doseras med modellen.** Passfilen från elitledet anger lägsta W′ för passet, och stakometer räknar fram watten med W′-anpassningen (spec §6.5). Se §4.1.
4. **stakometer fångar allt som går**, särskilt puls. Att ett pass kan finnas både här och i Garmin (dubbelräkning) löses senare, i elitledet.
5. **v2-listan i `spec.md` §2.2 är rensad** enligt §6. Det som hör till coachen byggs inte här.

## 3. Testbatteriet

### Varför just det här

Målet är en elitmotionär i långlopp. Det viktigaste talet är CP, och det ska vara sant i den långa änden, eftersom zonerna och alla lugna pass räknas från det.

- **Mortons modell i stället för tvåparametersmodellen.** Tvåparametersmodellen ur 3 + 12 min ger för samma atlet 1–2,5 % högre CP och 22–29 % lägre W′ än Mortons modell (räknat på standardsignaturen 430/180/10 000 och simulatorns 550/220/18 000). Mortons CP är den försiktigare, och det passar en atlet vars vanligaste fel är att lugna pass blir för hårda. Modellen ger också PP, som behövs för MPA-linjen.
- **12 min i stället för 10 min.** Den längsta punkten styr asymptoten. 12 min ligger fortfarande inom 2–15 min, där modellen brukar anpassas, och är det test kunskapsbasen redan rekommenderar.
- **6 min som fjärde punkt.** Den ger `P6min`, som kunskapsbasen använder för fraktionellt utnyttjande (CP / P6min). Med fyra punkter och tre parametrar blir det också en residual som visar hur väl kurvan passar. Med tre punkter går kurvan alltid exakt genom alla tre.
- **30 s behålls.** Den bestämmer PP och k. Om 30 s-punkten inte passar med de andra syns det i residualen.
- **3MAOT används inte.** Kunskapsbasen noterar att W′ från det testet är opålitligt på SkiErg.

### Så körs det

- Alla fyra inom 14 dagar, olika dagar eller högst två samma dag med minst 30 min lugnt emellan. Förslag: dag 1 12 min, dag 2 30 s och sedan 3 min, dag 3 6 min.
- Dragfaktorn ska vara densamma i alla test.
- Hur ofta testerna görs bestämmer elitledet. Tänkt schema: hela batteriet var 8:e vecka, och 30 s plus 6 min som kontroll var 4:e vecka. Kontrollen jämförs med kurvan men anpassar inte om den.
- Ett 40–60 min-test (elitledet) är en kontrollpunkt för den långa änden och ingår inte i anpassningen.

### Vad som ändras i appen (steg 4)

**Status: klart** (2026-09-29). Detaljerna står i spec §7 och §12.

- Nya testpass `test-360s` och `test-720s`. `test-600s` tas bort, eftersom det inte finns några gamla resultat att läsa.
- `TEST_DURATIONS` blir `[30, 180, 360, 720]`. Förslaget på ny signatur kräver minst tre olika längder inom 14 dagar, inte exakt tre bestämda. Senaste resultatet per längd används.
- `fit3p` klarar redan fler än tre punkter. Residualen (SSE och största avvikelse i watt) visas i resultatvyn.
- Dragfaktorn sparas i `TestResult`. Vid teststart visas en varning om den skiljer sig från förra testet för samma längd (mer än 5).

**Klart när:** fyra test i simulatorn (`fatigue`, sann signatur 550/220/18 000) ger CP inom ±3 % och W′ inom ±10 %, residualen visas, och varningen för dragfaktorn syns när den ändras.

## 4. Integrationen med elitledet

Två filer, inget annat. Ingen gemensam kod och ingen gemensam lagring.

### 4.1 In: planerade pass (steg 5)

**Status: klart** (2026-09-30). Formatet står i spec §6.7.

elitledet skriver en fil per vecka med `python -m planering`. Formatet är stakometers passformat (spec §6.1) med tre tillägg per pass (`id`, `date`, `calibration`) och atletens värden i `athlete`:

```json
{
  "format": "stakometer-plan",
  "version": 1,
  "athlete": { "maxHR": 188, "thresholdHR": 168, "cp": 215, "wPrime": 16500, "pp": 610, "dragFactor": 110, "asOf": "2026-10-04" },
  "workouts": [
    {
      "id": "2026-10-08-vo2",
      "date": "2026-10-08",
      "name": "5×4 min",
      "description": "Jämna intervaller.",
      "calibration": { "mode": "fit", "minWbal": 0.3 },
      "segments": [
        { "kind": "warmup", "duration": 900, "target": { "pctCP": 60 }, "description": "Lugnt." },
        { "kind": "interval", "duration": 240, "target": { "pctCP": 108 }, "repeat": 5,
          "rest": { "duration": 180, "target": { "pctCP": 45 } } },
        { "kind": "cooldown", "duration": 600, "target": null }
      ]
    }
  ]
}
```

- **`id`** är passets id i elitledets plan. Det sparas som `workoutId` på passet, så att elitledet kan koppla ihop planerat och genomfört utan att gissa.
- **`date`** styr bara ordningen i listan: dagens pass först.
- **`calibration`** ersätter inställningen i spec §8.5 för just det passet. `fit` med `minWbal` är standard för pass över CP: då är `pctCP` ett startvärde, och det är den lägsta W′-nivån som bestämmer watten. `off` används när watten i sig är poängen, till exempel ett pass som kontrollerar CP. Pass under CP påverkas inte, eftersom anpassningen bara ändrar arbete över CP.
- **`athlete`** (beslut 2026-09-30): maxpuls, tröskelpuls, vilopuls, vikt, PP, CP, W′ och dragfaktor, när coachen har dem. Alla är valfria. stakometer visar pulsen i procent av tröskel- eller maxpuls, varnar när planens CP eller W′ skiljer från den aktiva signaturen och när dragfaktorn skiljer från planens. Watten räknas alltid från stakometers egen signatur.
- **Från ostrukturerat till strukturerat** (beslut 2026-09-30): ett pass utan `segments` är bara namn och beskrivning och körs som fri åkning. Segment utan mål (`target: null`) visar tid och beskrivning. Block grupperar och upprepar segment, till exempel en uppvärmning eller 3 × (10 × 40/20).
- **`description`** kan stå på passet, varje segment, block och vila, och visas i livevyn.
- Import sker från fil på startsidan. Importerade pass sparas i databasen och följer med i backupen.
- En felaktig fil ger ett begripligt fel, och inget importeras.

Det här ersätter passeditorn, som inte längre är planerad.

**Klart när:** en fil med tre pass importeras, ett av dem körs, och backupen visar passet med rätt `workoutId` och den watt som anpassningen gav. `tests/plan.test.ts` kör kedjan med elitledets exempelfil (fyra pass) och simulatorn. Importen, startsidan och livevyn är också provade i Chrome med simulatorn.

### 4.2 Ut: backupen

Backupen i spec §11 (`format: 'skierg-backup'`) är det som elitledet läser. Den innehåller pass, tidslinje, signatur, drag, status, pauser, avbrott, testresultat och de planerade passen. Ett pass från planen har `workoutId` och en kopia av det planerade passet i `planned`.

- Formatet ändras bara med ny `version`, och elitledet ska uppdateras i samma veva.
- Rådata först (spec §11) gäller fortsatt: allt PM5 ger sparas, även det stakometer själv inte använder.
- Sammanfattningen per pass räknas som i dag. elitledet räknar med samma omsampling (spec §5.4) när den räknar själv.

## 5. Fånga allt som går (steg 6)

- **Puls från PM5 över USB.** `GETHRCUR` pollas redan (spec §9.1). Verifiera med ett pulsband parat med PM5, och markera [BEKRÄFTAT] i §9.1.
- **Separat pulsband** över Web Bluetooth (Heart Rate Service `0x180D`), för när PM5 inte ger puls. Pulsen sparas i statusdatan med samma tidsstämpel som allt annat.
- **Kraftkurva per drag** sparas som rådata. Hur den visas bestäms senare.
- **Övriga fält** från PM5 (Bluetooth `0035`, CSAFE-svar) sparas i `raw` som i dag.

Analysen av pulsen, som pulsdrift och HRR30/HRR60, görs i elitledet. stakometer visar pulsen live och i grafen efter passet.

**Klart när:** ett pass med pulsband ger puls i backupen, och §9 är uppdaterad med vad som är bekräftat.

## 6. v2-listan efter rensningen

**Kvar i stakometer:**

- Breakthroughs inom passet: när W′-balansen går under noll, föreslå ny signatur (steg 7)
- Kalibrering av W′-återhämtningen för stakning
- Separat pulsband och kraftkurva per drag (§5)
- PWA och offline-läge
- FIT-export, bara om passen ska till Garmin eller Strava

**Flyttat till elitledet:**

- Signaturens nedgång över veckor (decay)
- Low/High/Peak Load
- HRR30/HRR60-analys
- Form Check och träningsrekommendationer
- Import från Concept2 Logbook
- Passgenerator och maskininlärning
- ATL/CTL per energisystem

**Struket:**

- Gamification (Vasaloppet som kampanjkarta, Monster Masters)
- Passeditor i gränssnittet (ersätts av importen i §4.1)

## 7. Byggordning

Fortsätter numreringen i spec §12.

| Steg | Innehåll | Avsnitt |
|---|---|---|
| 4 | Testbatteriet: 6 och 12 min, residual, dragfaktor i testresultatet (klart 2026-09-29) | §3 |
| 5 | Import av planerade pass med `id`, `date`, `calibration`, `athlete`, beskrivningar och block (klart 2026-09-30) | §4.1 |
| 6 | Fånga mer: puls via PM5 och pulsband, kraftkurva som rådata | §5 |
| 7 | Breakthroughs inom passet | §6 |

## 8. Öppet

- **Dubbelräkning:** om Garmin-klockan också spelar in SkiErg-passet finns det två gånger. Löses i elitledet, senare.
- **W′-återhämtningen** är inte kalibrerad för stakning (spec §13). Ändras modellen ska elitledet följa med.
- **Pulsen över USB** är inte verifierad mot en riktig PM5.
