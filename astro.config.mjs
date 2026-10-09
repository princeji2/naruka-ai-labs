import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://orgs.social',
  output: 'static',
  build: {
    format: 'directory'
  }
});
