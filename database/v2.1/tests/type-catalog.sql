-- Read-only catalog input for the existing generated-type verifier (no regeneration).
SELECT json_build_object(
 'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,
 'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated))
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'functions',(SELECT json_agg(json_build_object('name',p.proname,'args',p.proargnames,
 'types',ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proargtypes::oid[]) t),
 'allTypes',ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proallargtypes) t),'modes',p.proargmodes,
 'defaults',p.pronargdefaults,'returns',pg_get_function_result(p.oid),'setof',p.proretset))
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'),
 'foreignKeys',(SELECT json_agg(json_build_object('name',con.conname,'table',con.conrelid::regclass::text,'target',con.confrelid::regclass::text,
 'columns',ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(n,i) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.n ORDER BY k.i),
 'targetColumns',ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(n,i) JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.n ORDER BY k.i),
 'oneToOne',EXISTS(SELECT 1 FROM pg_constraint u WHERE u.conrelid=con.conrelid AND u.contype IN ('p','u') AND u.conkey @> con.conkey AND u.conkey <@ con.conkey)))
 FROM pg_constraint con WHERE con.contype='f' AND con.connamespace='public'::regnamespace),
 'views',(SELECT coalesce(json_agg(viewname),'[]') FROM pg_views WHERE schemaname='public'),
 'enums',(SELECT coalesce(json_agg(t.typname),'[]') FROM pg_type t WHERE t.typnamespace='public'::regnamespace AND t.typtype='e'),
 'composites',(SELECT coalesce(json_agg(t.typname),'[]') FROM pg_type t JOIN pg_class c ON c.oid=t.typrelid
 WHERE t.typnamespace='public'::regnamespace AND t.typtype='c' AND c.relkind='c'));
