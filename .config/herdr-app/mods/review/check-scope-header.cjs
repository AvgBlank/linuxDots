// node extras/mods/review/check-scope-header.cjs: the Review page's own keys and base picker over the shared scope menu.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const kit = require('./check-kit.js');
function load(env) {
  const context = vm.createContext(env);
  vm.runInContext(kit.bundle(name => fs.readFileSync(path.join(__dirname, name), 'utf8'), 'scope-header.js', name => name === 'button.js' ? '' : null) + '\nglobalThis.api = {openScope,releaseScope,scopeRows,pickBase,scopeKey};', context);
  return context.api;
}
const state = new Map();
const cx = { notify() {}, stop_propagation() {}, spawn(fn) { return fn(cx); }, timer: { after() { return { cancel() {} }; } } };
const exec = async (_cmd, args, opts) => {
  if (args.includes('--show-toplevel')) return {code:0,stdout:opts.cwd+'\n'};
  if (args.includes('status')) return {code:0,stdout:'# branch.head fix\n# branch.upstream origin/fix\n# branch.ab +2 -0\n'};
  if (args.includes('symbolic-ref')) return {code:0,stdout:'origin/main\n'};
  if (args.includes('--left-right')) return {code:0,stdout:'0\t3\n'};
  if (args.includes('log')) return {code:0,stdout:'abc123\x1ffix: scope\x1f1\x1fA\n'};
  return {code:0,stdout:''};
};
const input = () => ({text:'',value(){return this.text;},set_value(v){this.text=v;},focus(){}});
const picked = [];
let liveSpaces = [{ id: 's' }];
let api;
const view = () => ({root:'/repo',space:'s',page:'/branch/fix',width:736,height:500,popup:'scope',handle:{focus(){}},scopeSearch:input(),refSearch:input(),
  closePopup(){this.popup=null; api.releaseScope(this);},
  pick(page,opts){picked.push({page,...opts});},
  openCommits(){}});
const element = kit.elements();
api = load({exec,shared:k=>state.get(k),setShared:(k,v)=>state.set(k,v),spaces:()=>liveSpaces,settings:()=>({zoom:1}),
  div:element,h_flex:element,v_flex:element,svg:element,Input:{new:element},drawButton:element,ghostButton:element,DISABLED:0.64});
const flush = async () => { for(let i=0;i<50;i++) await Promise.resolve(); };

(async () => {
  // A base picked: the space keeps it, Changes against it; the switch's pick stays open; dead spaces are pruned.
  const v = view(); api.openScope(v,cx); await flush();
  state.set('review.bases', { s: 'main', live: 'develop', dead: 'stale-branch' });
  liveSpaces = [{ id: 's' }, { id: 'live' }];
  api.pickBase(v, 'origin/dev', cx, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.get('review.bases'))), { s: 'origin/dev', live: 'develop' });
  assert.deepEqual(JSON.parse(JSON.stringify(picked.pop())), {page:'/compare/origin/dev...fix',stays:true});
  liveSpaces = [{ id: 's' }];
  state.delete('review.bases');

  // Keys: ↓ from nothing lights the first row; → on Commits opens it in the page; Escape goes back, Commits lit.
  const k = view(); api.openScope(k,cx); await flush();
  api.scopeKey(k,{key:'down'},cx); assert.equal(k.scopeAt,0);
  k.scopeAt = api.scopeRows(k).length - 1;
  k.openCommits = (cx, lit) => { k.scopePage = 'commits'; k.scopeListAt = lit; };
  api.scopeKey(k,{key:'right'},cx); assert.equal(k.scopePage,'commits');
  api.scopeKey(k,{keystroke:'escape'},cx); assert.ok(k.scopePage === null && k.scopeAt === api.scopeRows(k).length - 1);
  k.popup = 'settings'; assert.equal(api.scopeKey(k,{key:'down'},cx), false);
  console.log('ok: Review\'s scope keys go back from Commits in the page; its base picker keeps the space\'s base');
})().catch(error => { console.error(error); process.exit(1); });
