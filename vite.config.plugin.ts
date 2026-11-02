import { fileURLToPath, URL } from 'node:url'
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'inline-css-into-js',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) {
        let cssCode = '';
        for (const [fileName, asset] of Object.entries(bundle)) {
          if (fileName.endsWith('.css') && 'source' in asset) {
            cssCode += asset.source;
            delete bundle[fileName]; // 移除单独的 css 文件
          }
        }
        if (cssCode) {
          for (const [fileName, chunk] of Object.entries(bundle)) {
            if (fileName.endsWith('.js') && 'code' in chunk) {
              const injectScript = `(function(){
  if (typeof window !== 'undefined') {
    window.__injectMomentNotesStyles = function(targetDoc) {
      var doc = targetDoc || (typeof document !== 'undefined' ? document : null);
      if (!doc) return;
      var styleId = 'moment-notes-plugin-styles';
      if (!doc.getElementById(styleId)) {
        var s = doc.createElement('style');
        s.id = styleId;
        s.textContent = ${JSON.stringify(cssCode)};
        doc.head.appendChild(s);
      }
    };
  }
})();\n`;
              chunk.code = injectScript + chunk.code;
            }
          }
        }
      }
    },
    {
      name: 'copy-plugin-json',
      closeBundle() {
        mkdirSync('dist-plugin', { recursive: true });
        copyFileSync('toolkit-plugin/plugin.json', 'dist-plugin/plugin.json');
        copyFileSync('public/logo.png', 'dist-plugin/logo.png');
        console.log('✓ Copied toolkit-plugin/plugin.json and logo.png to dist-plugin');

        // 自动同步至本地 Toolkit 宿主插件安装目录，确保开发与运行即时生效
        try {
          const appData = process.env.APPDATA;
          if (appData) {
            const targetDir = `${appData}/com.tan18.toolkit/plugins/moment-notes`;
            mkdirSync(targetDir, { recursive: true });
            copyFileSync('dist-plugin/main.js', `${targetDir}/main.js`);
            copyFileSync('dist-plugin/plugin.json', `${targetDir}/plugin.json`);
            copyFileSync('dist-plugin/logo.png', `${targetDir}/logo.png`);
            console.log(`✓ Synced plugin build to ${targetDir}`);
          }
        } catch (e) {
          console.warn('! Failed to auto-sync to AppData plugins dir:', e);
        }
      }
    }
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@modules': fileURLToPath(new URL('./src/modules', import.meta.url)),
      '@stores': fileURLToPath(new URL('./src/stores', import.meta.url)),
      '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
      '@type': fileURLToPath(new URL('./src/types', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@views': fileURLToPath(new URL('./src/views', import.meta.url))
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `
          @use "@/styles/variables" as *;
          @use "@/styles/mixins" as *;
        `
      }
    }
  },
  build: {
    outDir: 'dist-plugin',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    lib: {
      entry: fileURLToPath(new URL('./src/entry-toolkit.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'main.js'
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true
      }
    }
  }
})
