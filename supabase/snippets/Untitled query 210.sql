BEGIN;

DO $$
DECLARE
    table_list TEXT;
BEGIN
    SELECT string_agg(
        format('%I.%I', schemaname, tablename),
        ', '
    )
    INTO table_list
    FROM pg_tables
    WHERE schemaname = 'public';

    IF table_list IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE '
            || table_list
            || ' RESTART IDENTITY';
    END IF;
END $$;

COMMIT;