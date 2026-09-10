import { Client } from 'pg';
const raw = await new Promise(r => { let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>r(d)); });
const v = JSON.parse(raw);
const url = v.DATABASE_URL || Object.entries(v).find(([k])=>/DATABASE_URL/i.test(k))?.[1];
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('=== 近 7 天 exec/sandbox 层故障(按错误类型)===');
const pats = [
  ['sandbox not running', '%Sandbox is probably not running%'],
  ['sandbox create/provision fail', '%failed to%sandbox%'],
  ['e2b error', '%e2b%error%'],
  ['exec unavailable', '%exec is unavailable%'],
  ['timeout', '%timed out%'],
  ['rate/quota', '%rate limit%'],
];
for (const [label, pat] of pats) {
  const r = (await c.query(`
    select count(*) n, count(distinct agent_id) agents from openhermit.session_events
    where ts > '2026-07-10' and event_type='tool_result' and payload->>'name'='exec'
      and payload->>'content' ilike $1`, [pat])).rows[0];
  if (+r.n > 0) console.log(`  ${label}: ${r.n} 次 / ${r.agents} agents`);
}
console.log('\n=== 近 7 天 exec 失败率最高的 agent(错误关键词粗筛)===');
const top = (await c.query(`
  select se.agent_id, a.name, count(*) n, max(se.ts) last,
         left(min(se.payload->>'content'), 90) sample
  from openhermit.session_events se join openhermit.agents a on a.agent_id=se.agent_id
  where se.ts > '2026-07-10' and se.event_type='tool_result' and se.payload->>'name'='exec'
    and (se.payload->>'content' ilike '%sandbox%' and se.payload->>'content' ilike '%error%'
      or se.payload->>'content' ilike '%Sandbox is probably not running%'
      or se.payload->>'content' ilike '%exec is unavailable%')
  group by 1,2 order by n desc limit 10`)).rows;
for (const r of top) console.log(`  ${r.name} x${r.n} last=${r.last.slice(5,16)} :: ${(r.sample||'').replace(/\s+/g,' ').slice(0,80)}`);
if (!top.length) console.log('  (无)');
console.log('\n=== pending sandbox 的 agent 近 7 天有没有人尝试 exec(懒 provision 是否在工作)===');
const pendTry = (await c.query(`
  select count(distinct se.agent_id) agents from openhermit.session_events se
  where se.ts > '2026-07-10' and se.event_type='tool_call' and se.payload->>'name'='exec'
    and se.agent_id in (
      select a.agent_id from openhermit.agents a
      where exists (select 1 from openhermit.sandboxes s where s.agent_id=a.agent_id and s.status='pending')
        and not exists (select 1 from openhermit.sandboxes s where s.agent_id=a.agent_id and s.status='provisioned'))`)).rows[0];
console.log(`  pending-only agent 中近 7 天用过 exec 的: ${pendTry.agents} 个`);
await c.end();
