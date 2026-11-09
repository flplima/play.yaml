import { libConfig } from '../vite.lib';

export default libConfig({
  root: __dirname,
  entries: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    export: 'src/export.ts',
    fidelity: 'src/fidelity.ts',
    'import-midi': 'src/import-midi.ts',
  },
  external: ['fs', 'path', '@play.yaml/node-audio', '@play.yaml/core', 'easymidi'],
  executables: ['cli', 'export', 'fidelity', 'import-midi'],
});
