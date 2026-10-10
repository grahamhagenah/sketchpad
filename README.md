# Bounce

A stripped-down sketchpad for writing song demos in the browser. Pick a key, mode, tempo and time signature, build a chord progression, and loop it — then take the idea into a full DAW.

## Features

- Diatonic chord palette for any major or minor key, with optional 7ths
- Timeline with drag-to-reorder and drag-to-resize chords, snapped to beats
- Loop playback over a draggable loop region, or play through once
- Songs in sections (intro, verse, pre-chorus, chorus, bridge, outro), each with its own chords and vocals; arrange them in a song view and play the whole song through
- Metronome, smooth voice-leading between chords, and a bass line
- Chords on a sampled piano, an electric piano, strings, a bell, or a synth with its own presets
- Keyboard shortcuts for everything; work is saved in the browser

## Development

```bash
npm install
npm run dev
```

Built with Vite, React, TypeScript, Tone.js and zustand.

## Credits

The piano is the [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), as prepared for [Tone.js](https://tonejs.github.io/audio/salamander/).
