import assert from 'node:assert/strict';
import { readFileSync,readdirSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve,join,dirname,relative } from 'node:path';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Use the already installed Desktop parser; this does not install a CLI or start the GUI.
const require=createRequire(import.meta.url);
if(process.versions.electron&&process.argv[2])process.chdir(process.argv[2]);
const langPath=process.env.BRUNO_LANG_PATH??join(process.env.LOCALAPPDATA??'C:/Users/TUF GAMING/AppData/Local','Programs/Bruno/resources/app.asar/node_modules/@usebruno/lang');
if(!process.versions.electron){
 const executable=process.env.BRUNO_EXECUTABLE??join(process.env.LOCALAPPDATA??'C:/Users/TUF GAMING/AppData/Local','Programs/Bruno/Bruno.exe');
 const logDirectory=resolve('node_modules/.cache/bruno-audit');mkdirSync(logDirectory,{recursive:true});
 try{execFileSync(executable,[fileURLToPath(import.meta.url),process.cwd()],{cwd:logDirectory,windowsHide:true,stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});process.exit(0);}catch{process.exit(1);}
}
process.on('uncaughtException',error=>{console.error(error.message);process.exit(1);});
const lang=require(langPath);const root=resolve('bruno/campaign-lab');
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
const bruFiles=files(root).filter(f=>f.endsWith('.bru'));const parsed=[];
const env=lang.bruToEnvJsonV2(readFileSync(join(root,'environments/local.bru'),'utf8'));
const collection=lang.collectionBruToJson(readFileSync(join(root,'collection.bru'),'utf8'));
assert.equal(JSON.parse(readFileSync(join(root,'bruno.json'),'utf8')).type,'collection');
const source=bruFiles.map(f=>readFileSync(f,'utf8')).join('\n');
assert.ok(!source.includes('bru.setEnvVar(')&&!source.includes('bru.setGlobalEnvVar('),'Never persist credentials/runtime state to tracked env');
const defined=new Set([...env.variables.map(v=>v.name),...Array.from(source.matchAll(/bru\.setVar\(['"]([^'"]+)['"]/g),m=>m[1]),'generationId','proposalVersion','proposalKey']);
const routes=files(resolve('src/app/api')).filter(path=>path.endsWith('route.ts'));
const applicationEndpoints=new Map(routes.map(path=>['/'+relative(resolve('src/app'),dirname(path)).replaceAll('\\','/'),Array.from(readFileSync(path,'utf8').matchAll(/(?:as\s+|function\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g),m=>m[1])]));
const endpoints=new Map([...applicationEndpoints,['/auth/v1/token',['POST']],['/rest/v1/business_members',['GET']]]);
for(const path of bruFiles){const text=readFileSync(path,'utf8');
 if(path.endsWith('local.bru')||path.endsWith('collection.bru'))continue;
 const request=lang.bruToJsonV2(text);assert.ok(request.http?.method&&request.http?.url,`Native HTTP parse: ${path}`);
 const url=request.http.url.replace('{{baseUrl}}','http://localhost:3100').replace('{{supabaseUrl}}','http://127.0.0.1:54321');const parsedUrl=new URL(url);
 assert.ok(endpoints.get(parsedUrl.pathname)?.includes(request.http.method.toUpperCase()),`Actual method/route required: ${path}`);
 assert.ok(!parsedUrl.pathname.includes('/rpc/'),'Privileged SQL RPCs are not client test requests');
 assert.match(text,/tests \{/);assert.match(text,/docs \{/);assert.match(text,/followRedirects: false/);
 if(request.http.method.toUpperCase()!=='GET')assert.match(text,/OPT_IN_REQUIRED: allow(Auth|Mutations)/,`Mutation/auth guard missing: ${path}`);
 for(const m of text.matchAll(/\{\{([^{}]+)\}\}/g))if(!m[1].startsWith('$'))assert.ok(defined.has(m[1]),`Undefined variable ${m[1]} in ${path}`);
 for(const script of Object.values(request.script??{}))if(typeof script==='string'&&script.trim())new Script(script,{filename:path});
 if(request.tests)new Script(request.tests,{filename:path});
 parsed.push({path:path.slice(root.length+1).replaceAll('\\','/'),...request});
}
for(const script of Object.values(collection.script??{}))if(typeof script==='string'&&script.trim())new Script(script);
assert.ok(parsed.length>0,'A collection with zero parsed HTTP requests is invalid');
const covered=new Set(parsed.filter(r=>r.http.url.startsWith('{{baseUrl}}')).map(r=>r.http.method.toUpperCase()+' '+new URL(r.http.url.replace('{{baseUrl}}','http://localhost:3100')).pathname));
const actualCombinations=new Set([...applicationEndpoints].flatMap(([path,methods])=>methods.map(method=>method+' '+path)));
assert.deepEqual([...covered].sort(),[...actualCombinations].sort(),'Every actual application method/path combination must be represented');
assert.ok(env.variables.filter(v=>/password|accessToken|AnonKey/i.test(v.name)).every(v=>v.secret&&!v.value),'Secret names only, never real values');
mkdirSync('node_modules/.cache/bruno-audit',{recursive:true});writeFileSync('node_modules/.cache/bruno-audit/parsed.json',JSON.stringify({parserVersion:require(langPath+'/package.json').version,env,collection,requests:parsed},null,2));
console.log(`PASS native Bruno parser ${require(langPath+'/package.json').version}: ${parsed.length} HTTP requests + environment/collection; actual URLs/methods, opt-ins, variable references and script syntax checked`);
