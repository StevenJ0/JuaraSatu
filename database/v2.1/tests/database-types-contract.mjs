import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function inspect(path) {
  const program=ts.createProgram([path],{strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2017});
  assert.equal(ts.getPreEmitDiagnostics(program).length,0,`Invalid generated TypeScript: ${path}`);
  const source=program.getSourceFile(path),checker=program.getTypeChecker();assert.ok(source);
  const symbol=checker.getExportsOfModule(checker.getSymbolAtLocation(source)).find(s=>s.name==="Database");assert.ok(symbol);
  const property=(type,name)=>{const s=type.getProperty(name);assert.ok(s,`Missing type property ${name}`);return checker.getTypeOfSymbolAtLocation(s,source);};
  const schema=property(checker.getDeclaredTypeOfSymbol(symbol),"public");
  return {source,checker,property,tables:property(schema,"Tables"),functions:property(schema,"Functions"),schema};
}

export function verifyDatabaseTypes(path,catalog,beforePath) {
  assert.ok(Array.isArray(catalog.columns) && Array.isArray(catalog.functions) && Array.isArray(catalog.foreignKeys));
  const m=inspect(path),{checker,property}=m;
  const names=t=>t.getProperties().map(s=>s.name).sort();
  const values=t=>t.isUnion() ? t.types : [t];
  const includesNull=t=>values(t).some(x=>(x.flags & ts.TypeFlags.Null)!==0);
  const present=t=>values(t).filter(x=>!(x.flags & (ts.TypeFlags.Null|ts.TypeFlags.Undefined)));
  function mapped(type,sqlType,context) {
    const stripped=present(type);assert.ok(stripped.length,context);
    assert.ok(!stripped.some(t=>t.flags & (ts.TypeFlags.Any|ts.TypeFlags.Unknown)),`Broad type: ${context}`);
    if(["json","jsonb"].includes(sqlType)) return; // Official Json preserves JSON values, not a business DTO.
    for(const part of stripped) {
      if(sqlType.endsWith("[]")) {
        assert.ok(checker.isArrayType(part),context);const [element]=checker.getTypeArguments(part);mapped(element,sqlType.slice(0,-2),context);continue;
      }
      const numeric=/^(smallint|integer|bigint|real|double precision|numeric|decimal)(\(|$)/.test(sqlType);
      const boolean=sqlType==="boolean";
      const flag=numeric ? ts.TypeFlags.NumberLike : boolean ? ts.TypeFlags.BooleanLike : ts.TypeFlags.StringLike;
      assert.ok(part.flags & flag,`${context}: SQL ${sqlType}, TS ${checker.typeToString(part)}`);
    }
  }
  const tableNames=[...new Set(catalog.columns.map(c=>c.table))].sort();assert.deepEqual(names(m.tables),tableNames);
  let columnCount=0,relationCount=0;
  for(const name of tableNames) {
    const table=property(m.tables,name),columns=catalog.columns.filter(c=>c.table===name);
    for(const kind of ["Row","Insert","Update"]) {
      const shape=property(table,kind);assert.deepEqual(names(shape),columns.map(c=>c.column).sort());
      for(const col of columns) {
        assert.equal(col.generated,"",`Generated-column handling must be reviewed: ${name}.${col.column}`);
        const symbol=shape.getProperty(col.column),type=checker.getTypeOfSymbolAtLocation(symbol,m.source);
        const optional=!!(symbol.flags & ts.SymbolFlags.Optional);
        assert.equal(optional,kind==="Update" || kind==="Insert" && (col.nullable || col.default!==null || col.identity!==""),`${name}.${col.column} ${kind} optionality`);
        mapped(type,col.type,`${name}.${col.column}/${kind}`);
        if(!["json","jsonb"].includes(col.type)) assert.equal(includesNull(type),col.nullable,`${name}.${col.column}/${kind} nullable`);
      }
    }
    columnCount+=columns.length;
    const relationships=property(table,"Relationships");assert.ok(checker.isTupleType(relationships));
    const actual=checker.getTypeArguments(relationships).map(type=>{
      const literal=name=>{const t=property(type,name);assert.ok(t.isStringLiteral());return t.value;};
      const tuple=name=>checker.getTypeArguments(property(type,name)).map(t=>{assert.ok(t.isStringLiteral());return t.value;});
      return {name:literal("foreignKeyName"),table:name,target:literal("referencedRelation"),columns:tuple("columns"),targetColumns:tuple("referencedColumns"),oneToOne:checker.typeToString(property(type,"isOneToOne"))==="true"};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    const expected=catalog.foreignKeys.filter(f=>f.table===name && !f.target.includes(".")).map(({name,table,target,columns,targetColumns,oneToOne})=>({name,table,target,columns,targetColumns,oneToOne})).sort((a,b)=>a.name.localeCompare(b.name));
    assert.deepEqual(actual,expected,`${name} public foreign-key relationships`);relationCount+=actual.length;
  }

  assert.deepEqual(names(m.functions),[...new Set(catalog.functions.map(f=>f.name))].sort());
  let signatures=0;
  for(const name of names(m.functions)) {
    const variants=values(property(m.functions,name)),expected=catalog.functions.filter(f=>f.name===name);
    assert.equal(variants.length,expected.length,`${name} overload count`);
    for(const fn of expected) {
      const argNames=(fn.args??[]).slice(0,fn.types.length);
      const variant=variants.find(v=>JSON.stringify(names(property(v,"Args")))===JSON.stringify(argNames.slice().sort()));assert.ok(variant,`${name} exact argument names`);
      const args=property(variant,"Args");
      for(const [index,arg] of argNames.entries()) {
        const s=args.getProperty(arg);assert.equal(!!(s.flags & ts.SymbolFlags.Optional),index>=argNames.length-fn.defaults,`${name}.${arg} default`);
        mapped(property(args,arg),fn.types[index],`${name}.${arg}`);
      }
      const result=property(variant,"Returns"),ret=fn.returns;
      if(ret==="void") assert.ok(result.flags & ts.TypeFlags.Undefined,`${name} void return`);
      else if(ret.startsWith("SETOF ") || ret.startsWith("TABLE(")) {
        assert.ok(checker.isArrayType(result),`${name} set return`);
        const [element]=checker.getTypeArguments(result),target=ret.replace(/^SETOF (public\.)?/,"");
        if(tableNames.includes(target)) {
          const row=property(property(m.tables,target),"Row");
          assert.ok(checker.isTypeAssignableTo(element,row) && checker.isTypeAssignableTo(row,element),`${name} set composite fields`);
        } else if(ret.startsWith("TABLE(")) {
          const outputs=fn.modes.map((mode,index)=>({mode,index})).filter(({mode})=>["o","t","b"].includes(mode));
          assert.deepEqual(names(element),outputs.map(({index})=>fn.args[index]).sort());
          for(const {index} of outputs) mapped(property(element,fn.args[index]),fn.allTypes[index],`${name} output ${fn.args[index]}`);
        }
      }
      else if(tableNames.includes(ret.replace(/^public\./,""))) {
        const row=property(property(m.tables,ret.replace(/^public\./,"")),"Row");
        assert.ok(checker.isTypeAssignableTo(result,row) && checker.isTypeAssignableTo(row,result),`${name} composite return`);
      } else mapped(result,ret,`${name} return`);
      signatures++;
    }
  }
  for(const [key,kind] of [["Views","views"],["Enums","enums"],["CompositeTypes","composites"]]) assert.deepEqual(names(property(m.schema,key)),catalog[kind].slice().sort());

  let before;
  if(beforePath) {
    const old=inspect(beforePath);
    const oldNames=t=>t.getProperties().map(s=>s.name);
    const oldTables=oldNames(old.tables),oldFns=oldNames(old.functions);
    before={missingTables:tableNames.filter(n=>!oldTables.includes(n)),missingColumns:[],missingRelationships:[],missingFunctions:names(m.functions).filter(n=>!oldFns.includes(n)),changedRpcOverloads:[],changedInsertOptionality:[]};
    for(const name of oldTables) if(tableNames.includes(name)) {
      const oldTable=old.property(old.tables,name),oldRow=old.property(oldTable,"Row");
      const oldRelations=old.checker.getTypeArguments(old.property(oldTable,"Relationships")).map(t=>old.property(t,"foreignKeyName").value);
      before.missingRelationships.push(...catalog.foreignKeys.filter(f=>f.table===name && !f.target.includes(".") && !oldRelations.includes(f.name)).map(f=>f.name));
      for(const col of catalog.columns.filter(c=>c.table===name)) {
        if(!oldRow.getProperty(col.column)) before.missingColumns.push(`${name}.${col.column}`);
        const p=old.property(oldTable,"Insert").getProperty(col.column);
        const expected=col.nullable || col.default!==null || col.identity!=="";
        if(p && !!(p.flags & ts.SymbolFlags.Optional)!==expected) before.changedInsertOptionality.push(`${name}.${col.column}`);
      }
    }
    for(const name of oldFns) if(m.functions.getProperty(name)) {
      const oldType=old.property(old.functions,name),count=oldType.isUnion()?oldType.types.length:1;
      const current=values(property(m.functions,name)).length;if(count!==current) before.changedRpcOverloads.push({name,before:count,after:current});
    }
  }
  const result={tables:tableNames.length,columns:columnCount,relationships:relationCount,rpcNames:names(m.functions).length,rpcSignatures:signatures,
    excludedCrossSchemaForeignKeys:catalog.foreignKeys.filter(f=>f.target.includes(".")).map(f=>f.name),before};
  console.log(`PASS generated type/catalog verification ${JSON.stringify(result)}`);return result;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2] && process.argv[3],"Usage: node database-types-contract.mjs <types.ts> <type-catalog.json> [before.ts]");
  verifyDatabaseTypes(resolve(process.argv[2]),JSON.parse(readFileSync(process.argv[3],"utf8")),process.argv[4] ? resolve(process.argv[4]):undefined);
}
