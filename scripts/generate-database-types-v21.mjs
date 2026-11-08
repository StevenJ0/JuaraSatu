import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runDatabaseContracts } from "../database/v2.1/tests/job-acknowledgement.mjs";
import { verifyDatabaseTypes } from "../database/v2.1/tests/database-types-contract.mjs";

// Official generator, only inside the positively verified disposable engine; no database URL is accepted.
await runDatabaseContracts({ fullChain:true,strictDocs:true,generateTypes:async h=>{
  const image="public.ecr.aws/supabase/postgres-meta:v0.100.0";
  h.docker(["image","inspect",image]);
  const network=`container:${h.container}`,label=`a5-types-${h.runId}`;
  let generator;
  try {
    generator=h.docker(["create","--rm","--network",network,"--label",`campaign_lab.disposable=${label}`,
      "--name",`campaign-lab-types-${h.runId}`,
      "-e","PG_META_DB_HOST=127.0.0.1","-e","PG_META_DB_PORT=5432","-e","PG_META_DB_USER=postgres","-e","PG_META_DB_NAME=postgres",
      "-e","PG_META_GENERATE_TYPES=typescript","-e","PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public",
      "-e","PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true",image]).trim();
    assert.match(generator,/^[a-f0-9]{64}$/);
    const [identity]=JSON.parse(h.docker(["inspect",generator]));
    assert.equal(identity.Id,generator);assert.equal(identity.Config.Labels["campaign_lab.disposable"],label);
    assert.equal(identity.HostConfig.NetworkMode,network);assert.deepEqual(identity.Mounts,[]);
    assert.ok(!identity.HostConfig.PortBindings || Object.keys(identity.HostConfig.PortBindings).length===0);
    assert.equal(h.sql("SHOW listen_addresses;"),"127.0.0.1");
    const output=h.docker(["start","--attach",generator]);
    assert.ok(output.includes("export type Database =")); assert.ok(!/\bany\b/.test(output),"Generated types must not contain any");
    const directory=resolve(h.root,"node_modules/.cache/database-types-v21",h.runId);mkdirSync(directory,{recursive:true});
    writeFileSync(resolve(directory,"official.database.types.ts"),output);
    writeFileSync(resolve(directory,"before.database.types.ts"),readFileSync(resolve(h.root,"src/lib/supabase/database.types.ts"),"utf8"));
    const catalog=h.json(`SELECT json_build_object('columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated))
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
      'functions',(SELECT json_agg(json_build_object('name',p.proname,'args',p.proargnames,'types',ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proargtypes::oid[]) t),
        'allTypes',ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proallargtypes) t),'modes',p.proargmodes,
        'defaults',p.pronargdefaults,'returns',pg_get_function_result(p.oid),'setof',p.proretset)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'),
      'foreignKeys',(SELECT json_agg(json_build_object('name',con.conname,'table',con.conrelid::regclass::text,'target',con.confrelid::regclass::text,
        'columns',ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(n,i) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.n ORDER BY k.i),
        'targetColumns',ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(n,i) JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.n ORDER BY k.i),
        'oneToOne',EXISTS(SELECT 1 FROM pg_constraint u WHERE u.conrelid=con.conrelid AND u.contype IN ('p','u') AND u.conkey @> con.conkey AND u.conkey <@ con.conkey)))
        FROM pg_constraint con WHERE con.contype='f' AND con.connamespace='public'::regnamespace),
      'views',(SELECT coalesce(json_agg(viewname),'[]') FROM pg_views WHERE schemaname='public'),
      'enums',(SELECT coalesce(json_agg(t.typname),'[]') FROM pg_type t WHERE t.typnamespace='public'::regnamespace AND t.typtype='e'),
      'composites',(SELECT coalesce(json_agg(t.typname),'[]') FROM pg_type t JOIN pg_class c ON c.oid=t.typrelid WHERE t.typnamespace='public'::regnamespace AND t.typtype='c' AND c.relkind='c'));`);
    writeFileSync(resolve(directory,"type-catalog.json"),JSON.stringify(catalog,null,2));
    const verification=verifyDatabaseTypes(resolve(directory,"official.database.types.ts"),catalog,resolve(directory,"before.database.types.ts"));
    writeFileSync(resolve(directory,"verification.json"),JSON.stringify(verification,null,2));
    writeFileSync(resolve(h.root,"node_modules/.cache/database-types-v21/latest.json"),JSON.stringify({directory},null,2));
    console.log(`OFFICIAL TYPE CANDIDATE ${directory}; postgres-meta v0.100.0; public only, network shares isolated PostgreSQL loopback`);
    if(process.argv.includes("--write")) writeFileSync(resolve(h.root,"src/lib/supabase/database.types.ts"),output);
  } finally {
    if(generator) {
      const remaining=JSON.parse(h.docker(["ps","--all","--filter",`id=${generator}`,"--format","{{json .ID}}"] ).trim() || "null");
      if(remaining) {
        const [identity]=JSON.parse(h.docker(["inspect",generator]));
        assert.equal(identity.Id,generator);assert.equal(identity.Config.Labels["campaign_lab.disposable"],label);
        assert.equal(identity.HostConfig.NetworkMode,network);h.docker(["rm","--force",generator]);
      }
      console.log(`CLEANUP official generator ${label}`);
    }
  }
} });
