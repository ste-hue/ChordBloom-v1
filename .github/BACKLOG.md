# ChordBloom Backlog

**Ordine di esecuzione:**
PR #10 → PR #9 → main → Issue 1 → Issue 2 → ... → Issue 7

---

## 1. Add phrase-level harmonic quality tests before Harmonic Engine v2

**Infrastructure + Tests** — nessuna modifica all'output, pura diagnostica

### Verificare:
- Cadenze realmente risolte
- Dominant → Tonic
- Applied dominant verso il proprio target
- Tecniche cromatiche non accumulate casualmente
- Rapporto ultimo → primo nei loop
- Diagnostica della violazione armonica
- Determinismo senza snapshot rigidi degli accordi

**Status:** Copertura attuale: MIDI, MPE, range, griglia, determinismo  
**Gap:** Coerenza musicale della frase

---

## 2. Replace degree skeletons with a phrase-level functional planner

**Core refactor** — introdurre un livello precedente alla scelta degli accordi

### Piano armonico esplicito:
```
TONIC → TONIC PROLONGATION → PREDOMINANT → DOMINANT
```

### Il planner decide:
- Arco funzionale
- Punti di partenza, sviluppo, picco, risoluzione
- Struttura diversa per: functional, modal, electronic loop
- Eventuale cadenza
- Funzione di ogni posizione

**Nota:** Non introduce beam search. Sostituisce "sequenza di gradi" con piano armonico esplicito.

---

## 3. Add resolution contracts for chromatic harmonic techniques

**Core feature** — ogni tecnica avanzata dichiara i propri vincoli

### Per ogni tecnica:
```
allowedRoles
allowedPositions
resolutionTarget
maximumResolutionDistance
```

### Esempi:
- Secondary dominant → risolve al target
- Secondary ii–V → ii/x → V/x → x
- Augmented sixth → va al dominante
- Neapolitan → prepara una funzione dominante
- Tritone substitution → risolve cromaticamente
- Line cliché → prolunga una funzione
- Chromatic mediant → colore strutturale

**Attualmente:** Tecniche entrano come candidati locali in scoring numerico  
**Obiettivo:** Vincoli dichiarati, non casualità

---

## 4. Rank complete progressions with bounded beam search

**Algorithm** — ranking su intera frase, non sinistra-destra

### Implementazione:
- Mantenere i migliori 12–16 percorsi a ogni posizione
- Scartare immediatamente violazioni armoniche
- Valutare: cadenza, funzione, risoluzioni, stile, tensione sull'intero percorso
- Selezionare deterministicamente fra i migliori usando il seed

**Filosofia:** Varietà dentro una frase valida, non caos

---

## 5. Add a manipulable harmonic-tension curve with device-specific interaction

**Feature** — curve tensione per device specifico, dopo gerarchia armonica

### Modello universale:
```
x = posizione nella frase
y = tensione armonica desiderata
```

### Influenza:
- Probabilità delle funzioni
- Densità delle estensioni
- Possibilità di cromatismo
- Intensità della dominante
- Collocazione del picco
- Forza della risoluzione

### Non viola:
- Obblighi di risoluzione
- Funzione prevista
- Grammatica della cadenza

### Computer — Editor preciso:
- Grafico largo
- 5 punti: Start, Development, Peak, Release, End
- Trascinamento libero
- Tooltip con valore
- Doppio clic per ripristinare
- Preset selezionabili
- Anteprima immediata

### iPhone — Interfaccia intuitiva:
- Editor in pannello largo o full-screen
- 4 punti grandi: Start, Build, Peak, Resolve
- Movimento principalmente verticale
- Snap leggero
- Pulsanti preset grandi
- Nessuna aggiunta/rimozione libera (v1)
- Target touch ≥ 44 px
- Leggibilità in portrait

**Note:** I 4 punti mobile → interpolazione nello stesso formato normalizzato del desktop

---

## 6. Separate the marketing landing page from the composition workspace

**UX** — `/` (landing) vs `/app/` (workspace)

### Desktop landing:
- Hero ampio
- Progressione dimostrativa ascoltabile
- Visualizzazione della curva
- Prodotto mostrato lateralmente
- CTA principale verso `/app/`

### iPhone landing:
- Hero verticale
- Promessa breve
- Pulsante Play immediatamente raggiungibile
- Piccola progressione scorrevole
- CTA sticky
- Niente screenshot desktop compresso

**Attualmente:** Singolo workspace statico, build copia `src/` → `dist/`  
**Implementazione:** Separazione leggera, nessun nuovo framework

---

## 7. Give new users three successful MIDI exports before the credit paywall

**Monetization + UX** — trial exports gratuiti

### Regola:
```
Creazione e ascolto: illimitati
Export MIDI: 3 gratuiti, poi 100 a €9,99
```

### Definizione "export gratuito consumato":
- Decremento solo dopo salvataggio riuscito
- Cancellazione file picker: non consuma
- Errore salvataggio: non consuma
- Pannello: mostra 3, 2, 1 free exports
- Terminati i 3: entra wallet Lemon Squeezy (esistente)
- Nessuna modifica: generation, playback, MPE preview

**Prerequisito:** Aggiorna prima la decisione di prodotto (la specifica attuale esclude download gratuiti)

---

## Principio di interazione
iPhone ≠ Computer
- **Stato e motore:** Identici
- **Superfici:** Diverse
- **Desktop:** Precisione e densità
- **iPhone:** Selezione rapida, target touch grandi, un compito alla volta
