import { libConfig } from '../vite.lib';

export default libConfig({
  root: __dirname,
  entries: { index: 'src/index.ts' },
  external: [],
  declarations: true,
});
