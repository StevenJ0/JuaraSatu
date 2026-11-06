-- Read-only catalog snapshot shared by disposable and real local verification.
SET search_path=public;
SELECT json_build_object(
 'tables',(SELECT json_agg(json_build_object('table',c.relname,'rls',c.relrowsecurity,
  'privileges',(SELECT json_object_agg(r,json_build_object('select',has_table_privilege(r,c.oid,'SELECT'),
   'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),
   'delete',has_table_privilege(r,c.oid,'DELETE'))) FROM unnest(ARRAY['anon','authenticated','service_role']) r)) ORDER BY c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
 'columns',(SELECT json_agg(json_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
  'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT json_agg(json_build_object('table',c.conrelid::regclass::text,'name',c.conname,'kind',c.contype,
  'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text,c.conname)
  FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
 'indexes',(SELECT json_agg(i ORDER BY i.tablename,i.indexname) FROM pg_indexes i WHERE schemaname='public'),
 'policies',(SELECT json_agg(p ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public'),
 'triggers',(SELECT json_agg(json_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'definition',pg_get_triggerdef(t.oid))
  ORDER BY t.tgrelid::regclass::text,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
 'functions',(SELECT json_agg(json_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
  'definition',pg_get_functiondef(p.oid),'privileges',(SELECT json_object_agg(r,has_function_privilege(r,p.oid,'EXECUTE'))
   FROM unnest(ARRAY['anon','authenticated','service_role']) r)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'),
 'extensions',(SELECT json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname)
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace));
