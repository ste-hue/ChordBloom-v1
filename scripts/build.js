import {rm,mkdir,cp,readdir,stat} from 'node:fs/promises';import path from 'node:path';
const root=process.cwd(),src=path.join(root,'src'),dist=path.join(root,'dist');await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});await cp(src,dist,{recursive:true});console.log('Built static site → dist/');
