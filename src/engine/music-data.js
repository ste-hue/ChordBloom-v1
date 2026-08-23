export const NOTE_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const NOTE_NAMES_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const ROOTS = ['C','C#','Db','D','Eb','E','F','F#','Gb','G','Ab','A','Bb','B'];
export const ROOT_TO_PC = Object.freeze({C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11});

export const SCALES = Object.freeze({
  'Major / Ionian': [0,2,4,5,7,9,11],
  'Natural Minor / Aeolian': [0,2,3,5,7,8,10],
  'Harmonic Minor': [0,2,3,5,7,8,11],
  'Melodic Minor': [0,2,3,5,7,9,11],
  'Dorian': [0,2,3,5,7,9,10],
  'Phrygian': [0,1,3,5,7,8,10],
  'Lydian': [0,2,4,6,7,9,11],
  'Mixolydian': [0,2,4,5,7,9,10],
  'Locrian': [0,1,3,5,6,8,10],
  'Dorian b2': [0,1,3,5,7,9,10],
  'Lydian Augmented': [0,2,4,6,8,9,11],
  'Lydian Dominant': [0,2,4,6,7,9,10],
  'Mixolydian b6': [0,2,4,5,7,8,10],
  'Locrian #2': [0,2,3,5,6,8,10],
  'Altered / Super Locrian': [0,1,3,4,6,8,10],
  'Harmonic Major': [0,2,4,5,7,8,11],
  'Double Harmonic Major': [0,1,4,5,7,8,11],
  'Phrygian Dominant': [0,1,4,5,7,8,10],
  'Whole Tone': [0,2,4,6,8,10],
  'Diminished Half-Whole': [0,1,3,4,6,7,9,10],
  'Diminished Whole-Half': [0,2,3,5,6,8,9,11]
});

export const STYLES = Object.freeze({
  HOUSE:{extensions:.35, chromatic:.15, spread:.48, register:60, arpDensity:.35, tension:.35, loop:.9, rhythm:'House'},
  DEEP:{extensions:.62, chromatic:.28, spread:.64, register:55, arpDensity:.28, tension:.44, loop:.95, rhythm:'Sparse'},
  ELECTRONICA:{extensions:.58, chromatic:.52, spread:.72, register:59, arpDensity:.58, tension:.55, loop:.82, rhythm:'Syncopated'},
  'UK GARAGE / UKG':{extensions:.68, chromatic:.42, spread:.57, register:61, arpDensity:.55, tension:.52, loop:.94, rhythm:'Garage'},
  ROMANTIC:{extensions:.72, chromatic:.48, spread:.76, register:64, arpDensity:.32, tension:.58, loop:.55, rhythm:'Ambient'},
  CINEMATIC:{extensions:.75, chromatic:.72, spread:.88, register:57, arpDensity:.45, tension:.68, loop:.5, rhythm:'Sparse'},
  DISCO:{extensions:.56, chromatic:.2, spread:.55, register:62, arpDensity:.4, tension:.35, loop:.85, rhythm:'Offbeat'},
  'SOULFUL HOUSE':{extensions:.8, chromatic:.38, spread:.7, register:61, arpDensity:.38, tension:.46, loop:.9, rhythm:'House'},
  'DEEP HOUSE':{extensions:.66, chromatic:.28, spread:.7, register:57, arpDensity:.32, tension:.4, loop:.96, rhythm:'House'},
  'TECH HOUSE':{extensions:.26, chromatic:.15, spread:.4, register:55, arpDensity:.34, tension:.4, loop:.98, rhythm:'House'},
  'GARAGE HOUSE':{extensions:.62, chromatic:.3, spread:.56, register:61, arpDensity:.5, tension:.44, loop:.95, rhythm:'Garage'},
  BREAKS:{extensions:.45, chromatic:.4, spread:.58, register:59, arpDensity:.65, tension:.55, loop:.9, rhythm:'Broken Beat'},
  AMBIENT:{extensions:.78, chromatic:.5, spread:.9, register:67, arpDensity:.42, tension:.38, loop:.8, rhythm:'Ambient'},
  'NEO-SOUL':{extensions:.95, chromatic:.62, spread:.78, register:61, arpDensity:.4, tension:.57, loop:.74, rhythm:'Syncopated'},
  'R&B':{extensions:.82, chromatic:.48, spread:.72, register:60, arpDensity:.35, tension:.48, loop:.84, rhythm:'Sparse'},
  POP:{extensions:.28, chromatic:.12, spread:.5, register:62, arpDensity:.28, tension:.3, loop:.78, rhythm:'Straight'},
  INDIE:{extensions:.35, chromatic:.25, spread:.62, register:61, arpDensity:.3, tension:.42, loop:.82, rhythm:'Straight'},
  JAZZY:{extensions:.95, chromatic:.75, spread:.74, register:60, arpDensity:.5, tension:.72, loop:.65, rhythm:'Syncopated'},
  MINIMAL:{extensions:.18, chromatic:.1, spread:.4, register:58, arpDensity:.26, tension:.25, loop:.99, rhythm:'Sparse'},
  DARK:{extensions:.58, chromatic:.5, spread:.68, register:52, arpDensity:.4, tension:.7, loop:.9, rhythm:'Sparse'},
  EUPHORIC:{extensions:.5, chromatic:.2, spread:.8, register:66, arpDensity:.55, tension:.45, loop:.9, rhythm:'Dense'}
});

export const MOODS = Object.freeze({
  Dreamy:{brightness:.2,tension:.3,modal:.65}, Deep:{brightness:-.2,tension:.4,modal:.5}, Euphoric:{brightness:.8,tension:.45,modal:.25},
  Melancholic:{brightness:-.65,tension:.5,modal:.55}, Tension:{brightness:-.1,tension:.95,modal:.45}, Romantic:{brightness:.2,tension:.55,modal:.65},
  Dark:{brightness:-.9,tension:.75,modal:.7}, Hopeful:{brightness:.65,tension:.3,modal:.35}, Nostalgic:{brightness:-.1,tension:.4,modal:.7},
  Suspended:{brightness:.05,tension:.55,modal:.9}, Mysterious:{brightness:-.35,tension:.7,modal:.85}, Warm:{brightness:.45,tension:.25,modal:.55}, Hypnotic:{brightness:-.05,tension:.4,modal:.75}
});

export const FUNCTIONS = ['TONIC','TONIC PROLONGATION','PREDOMINANT','DOMINANT','DOMINANT SUBSTITUTE','CHROMATIC APPROACH','MODAL COLOR'];
export const RHYTHM_GRIDS = {'1/4':480,'1/8':240,'1/8T':160,'1/16':120,'1/16T':80,'1/32':60,'dotted 1/8':360,'dotted 1/16':180};
