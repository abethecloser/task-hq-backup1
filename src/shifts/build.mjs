import { build } from 'vite';
import react from '@vitejs/plugin-react';
await build({configFile:false,root:new URL('.',import.meta.url).pathname,base:'./',plugins:[react()],build:{outDir:'/private/tmp/quest-shift-preview',emptyOutDir:true,rollupOptions:{input:new URL('./index.html',import.meta.url).pathname}}});
