import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {networkInterfaces} from 'node:os';
import {OnlineService} from './server/online-server.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.ttf':'font/ttf','.swf':'application/x-shockwave-flash','.ico':'image/x-icon'};
export function createGameServer(options={}){
  let online;
  const server=http.createServer(async(req,res)=>{
    try{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,online:true,rooms:online.rooms.size}));return;}
      const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      const file=path.resolve(root,'.'+pathname);
      const relative=path.relative(root,file).split(path.sep).join('/');
      if(!file.startsWith(root+path.sep)||!['index.html','favicon.svg'].includes(relative)&&!/^((assets|src)\/)/.test(relative)){res.writeHead(404);res.end('Not found');return;}
      const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
      const content=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:content);
    }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('파일을 찾을 수 없습니다.');}
  });
  online=new OnlineService(server,options);
  return {server,online,async close(){await online.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const port=Number(process.env.PORT||5173),host=process.env.HOST||'0.0.0.0';
  const game=createGameServer({allowedOrigins:(process.env.ALLOWED_ORIGINS||'').split(',').map(origin=>origin.trim()).filter(Boolean)});
  game.server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  game.server.listen(port,host,()=>{
    console.log('Flash Versus ready → http://127.0.0.1:'+port);
    for(const address of Object.values(networkInterfaces()).flat())if(address?.family==='IPv4'&&!address.internal)console.log('Network play → http://'+address.address+':'+port);
  });
  const stop=()=>game.close().finally(()=>process.exit());
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
