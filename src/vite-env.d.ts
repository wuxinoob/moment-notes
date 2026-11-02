/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  __TOOLKIT_CTX__?: any;
  __isFileDialogActive?: boolean;
}

declare const __APP_VERSION__: string;
