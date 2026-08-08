import { parseDocument } from 'yaml';
function bomb(depth, fan) {
  let s = 'base: &l0\n  k: v\n';
  for (let i=1;i<=depth;i++){
    s += `l${i}: &l${i}\n  <<: [${Array(fan).fill(`*l${i-1}`).join(',')}]\n  u${i}: ${i}\n`;
  }
  return s;
}
for (const d of [4,5,6,7]) {
  const src = bomb(d, 9);
  const t0 = Date.now();
  try { const doc = parseDocument(src, {merge:true}); doc.toJS(); console.log(`depth ${d}: bytes=${src.length} NO THROW ${Date.now()-t0}ms`); }
  catch(e){ console.log(`depth ${d}: threw ${e.message} ${Date.now()-t0}ms`); }
}
// merge error surfacing
const bad = 'x:\n  <<: "not a map"\n';
const d1 = parseDocument(bad, {merge:true});
console.log('doc.errors:', d1.errors.length);
try { d1.toJS(); console.log('no throw'); } catch(e){ console.log('toJS threw:', e.constructor.name, e.message); }
