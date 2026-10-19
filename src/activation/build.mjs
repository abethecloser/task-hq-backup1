import {build} from 'vite';
import react from '@vitejs/plugin-react';
await build({configFile:false,root:new URL('.',import.meta.url).pathname,envDir:new URL('../..',import.meta.url).pathname,base:'./',define:{'import.meta.env.VITE_TASK_HQ_HOME':JSON.stringify(process.env.ACTIVATION_PREVIEW_HOME??'')},plugins:[react()],build:{outDir:process.env.ACTIVATION_BUILD_DIR??new URL('../../public/activate',import.meta.url).pathname,emptyOutDir:true}});
