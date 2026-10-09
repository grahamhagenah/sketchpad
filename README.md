# Sketchpad

A stripped-down chord sketchpad for writing song demos in the browser. Pick a key, mode, tempo and time signature, build a chord progression, and loop it — then take the idea into a full DAW.

## Features

- Diatonic chord palette for any major or minor key, with optional 7ths
- Timeline with drag-to-reorder and drag-to-resize chords, snapped to beats
- Loop playback over a draggable loop region, or play through once
- Songs in sections (intro, verse, pre-chorus, chorus, bridge, outro), each with its own chords and vocals; arrange them in a song view and play the whole song through
- Metronome, smooth voice-leading between chords, and a bass line
- Keyboard shortcuts for everything; work is saved in the browser

## Development

```bash
npm install
npm run dev
```

Built with Vite, React, TypeScript, Tone.js and zustand.
