import { libConfig } from '../vite.lib';

export default libConfig({
  root: __dirname,
  entries: { index: 'src/index.ts' },
  external: ['fs', 'os', 'path', 'child_process', 'node-web-audio-api', '@play.yaml/core'],
  declarations: true,
});
