import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCore} from './helpers/load-core.js';

const core=await loadCore();

test('mintIdempotencyKey returns unique non-empty strings',()=>{
  const a=core.mintIdempotencyKey(), b=core.mintIdempotencyKey();
  assert.ok(typeof a==='string'&&a.length>0);
  assert.notEqual(a,b);
});

test('requestSpend success path returns balance and wallet id',async()=>{
  let seen;
  const fetchImpl=async(url,opts)=>{ seen={url,opts}; return {ok:true,status:200,json:async()=>({wallet_id:'w-1',balance:41})}; };
  const res=await core.requestSpend(fetchImpl,'https://api.example','KEY','idem-1');
  assert.deepEqual(res,{ok:true,status:200,balance:41,walletId:'w-1'});
  assert.equal(seen.url,'https://api.example/wallet/spend');
  assert.equal(seen.opts.headers['X-License-Key'],'KEY');
  assert.equal(JSON.parse(seen.opts.body).idempotency_key,'idem-1');
});

test('requestSpend surfaces 402 without throwing',async()=>{
  const fetchImpl=async()=>({ok:false,status:402,json:async()=>({error:'insufficient_credits'})});
  const res=await core.requestSpend(fetchImpl,'https://api.example','KEY','idem-2');
  assert.equal(res.ok,false); assert.equal(res.status,402);
});

test('requestSpend maps a network failure to status 0',async()=>{
  const fetchImpl=async()=>{ throw new Error('offline'); };
  const res=await core.requestSpend(fetchImpl,'https://api.example','KEY','idem-3');
  assert.deepEqual(res,{ok:false,status:0});
});
