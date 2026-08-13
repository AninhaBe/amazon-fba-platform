import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { LOCAL_HOSTS, assertLocalTarget, buildPlan, inspectFinancialLedgerContract, inspectTarget, loadMigrations, newRunId, parseArgs, safeTarget, savePlan, validateApply } from "./migration-safety.mjs";
import { assertFinancialLedgerContract, assertFinancialLedgerPrecheck, financialLedgerContractHash, FINANCIAL_LEDGER_CONTRACT_SQL, FINANCIAL_LEDGER_CONTRACT_VERSION, FINANCIAL_LEDGER_MIGRATION, materializeFinancialLedgerMigration } from "./migration-contracts.mjs";

const mode=process.argv[2], args=parseArgs(process.argv.slice(3)), environment=args.environment, databaseUrl=process.env.DATABASE_URL, runId=newRunId();
const audit=(result,extra={})=>console.log(JSON.stringify({event:"migration-run",runId,actor:process.env.USER||process.env.USERNAME||"unknown",environment,result,...extra}));
function gitState(){try{return{commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),dirty:execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim().length>0};}catch{return{commit:"untracked",dirty:true};}}
if(mode==="guard"){console.error("BLOCKED: npm run migrate e somente uma trava. Use migrate:plan e o fluxo autorizado.");process.exit(2);}
if(!["plan","local","apply"].includes(mode))throw new Error("Modo invalido.");
if(!environment||!["local","staging","production"].includes(environment))throw new Error("BLOCKED: environment explicito invalido.");
if(!databaseUrl)throw new Error("BLOCKED: DATABASE_URL ausente.");
if(!args["runtime-role"])throw new Error("BLOCKED: --runtime-role e obrigatorio no plano e no apply.");
const target=safeTarget(databaseUrl); assertLocalTarget(environment,target);
if(mode==="local"&&environment!=="local")throw new Error("BLOCKED: migrate:local exige --environment local.");
const git=gitState(), migrations=await loadMigrations(path.resolve("migrations"));
const auditBase={targetFingerprint:target.fingerprint,commit:git.commit,dirty:git.dirty,migrationHashes:migrations.map(({name,hash})=>({name,hash}))};
let authorizationReference;
const pool=new pg.Pool({connectionString:databaseUrl,ssl:LOCAL_HOSTS.has(target.host)?false:{rejectUnauthorized:false},max:1});
try{
  const {identity,applied}=await inspectTarget((sql)=>pool.query(sql));
  const fm=migrations.find((m)=>m.name===FINANCIAL_LEDGER_MIGRATION); if(!fm)throw new Error("BLOCKED: migration 0005 ausente.");
  const rr=await pool.query("SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.oid=(SELECT datdba FROM pg_database WHERE datname=current_database()) AS database_owner,r.oid=(SELECT nspowner FROM pg_namespace WHERE nspname=current_schema()) AS schema_owner,r.rolname=current_user AS current_role FROM pg_roles r WHERE r.rolname=$1",[args["runtime-role"]]);
  if(rr.rowCount!==1||rr.rows[0].rolsuper||rr.rows[0].rolbypassrls||rr.rows[0].database_owner||rr.rows[0].schema_owner||rr.rows[0].current_role||["public","anon","authenticated"].includes(rr.rows[0].rolname))throw new Error("BLOCKED: runtime role inexistente, owner, current_user ou com bypass.");
  await pool.query("SELECT set_config('sellercore.runtime_role',$1,false)",[rr.rows[0].rolname]);
  const contractHash=financialLedgerContractHash(fm.sql);
  const contract=await inspectFinancialLedgerContract((sql)=>pool.query(sql),FINANCIAL_LEDGER_CONTRACT_SQL);
  if(applied.some(({name})=>name===FINANCIAL_LEDGER_MIGRATION))assertFinancialLedgerContract(contract,contractHash); else assertFinancialLedgerPrecheck(contract);
  const plan=buildPlan({environment,target,identity,migrations,applied,git,runtimeRole:rr.rows[0].rolname});
  const summary={targetFingerprint:target.fingerprint,database:identity.database,schema:identity.schema,role:identity.role,commit:git.commit,dirty:git.dirty,planHash:plan.planHash,migrations:plan.migrations,contract0005:contract};
  console.log(JSON.stringify({preflight:summary},null,2));
  if(mode==="plan"){
    if(!args.out)throw new Error("BLOCKED: migrate:plan exige --out."); await savePlan(args.out,plan); audit("PLANNED",summary);
  }else{
    if(!args.plan||!args.authorization||!args["runtime-role"])throw new Error("BLOCKED: --plan, --authorization e --runtime-role sao obrigatorios.");
    const diskPlan=JSON.parse(await readFile(args.plan,"utf8")), authorization=JSON.parse(await readFile(args.authorization,"utf8")); authorizationReference=authorization.reference;
    validateApply({args,environment,target,identity,plan:diskPlan,authorization,git,publicKey:process.env.MIGRATION_AUTH_PUBLIC_KEY});
    if(JSON.stringify(diskPlan.migrations)!==JSON.stringify(plan.migrations))throw new Error("BLOCKED: hashes/pendencias mudaram desde o preflight.");
    for(const migration of migrations.filter((m)=>diskPlan.migrations.find((p)=>p.name===m.name)?.status==="pending")){
      await pool.query("BEGIN");
      try{
        let sql=migration.sql;
        if(migration.name===FINANCIAL_LEDGER_MIGRATION){
          await pool.query("SELECT set_config('sellercore.runtime_role',$1,true)",[rr.rows[0].rolname]); sql=materializeFinancialLedgerMigration(sql,contractHash);
        }
        await pool.query(sql);
        if(migration.name===FINANCIAL_LEDGER_MIGRATION){
          const post=await inspectFinancialLedgerContract((q)=>pool.query(q),FINANCIAL_LEDGER_CONTRACT_SQL);
          assertFinancialLedgerPrecheck(post);
          await pool.query("INSERT INTO migration_contract_versions(migration_name,contract_version,contract_hash,updated_at) VALUES($1,$2,$3,clock_timestamp()) ON CONFLICT(migration_name) DO UPDATE SET contract_version=EXCLUDED.contract_version,contract_hash=EXCLUDED.contract_hash,updated_at=EXCLUDED.updated_at",[migration.name,FINANCIAL_LEDGER_CONTRACT_VERSION,contractHash]);
          const certified=await inspectFinancialLedgerContract((q)=>pool.query(q),FINANCIAL_LEDGER_CONTRACT_SQL);
          assertFinancialLedgerContract(certified,contractHash);
        }
        await pool.query("INSERT INTO schema_migrations(name,migration_hash) VALUES($1,$2)",[migration.name,migration.hash]); await pool.query("COMMIT");
      }catch(error){await pool.query("ROLLBACK");throw error;}
    }
    audit("APPLIED",{...summary,authorizationReference:authorization.reference,authorizationActor:authorization.actor});
  }
}catch(error){audit("BLOCKED_OR_FAILED",{...auditBase,authorizationReference,message:error instanceof Error?error.message:String(error)});throw error;}finally{await pool.end();}
