import test from 'node:test';
import assert from 'node:assert/strict';
import { liveMarkets } from '../lib/feeds.js';
const market = ticker => ({ ticker, status: 'active', close_time: new Date(Date.now()+600000).toISOString(), title: ticker });
const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json' } });
function fixture({ badSeries=false, badBook=false, empty=false }={}) {
  return async address => {
    const url=new URL(address);
    const series=url.searchParams.get('series_ticker');
    if (series) {
      if (badSeries && series==='KXETH15M') return json({},503);
      return json({markets:empty?[]:[market(`${series}-TEST`)]});
    }
    if (url.pathname.endsWith('/markets/BAD-TICKER')) return json({},404);
    if (url.pathname.endsWith('/orderbook')) {
      if(badBook && url.pathname.includes('KXETH15M')) return json({},429);
      return json({orderbook_fp:{yes_dollars:[['0.5','1000']],no_dollars:[['0.48','1000']]}});
    }
    if (url.pathname.endsWith('/trades')) return json({trades:[]});
    throw new Error('Unexpected fixture route');
  };
}
test('a failed series and an invalid custom ticker leave healthy markets usable',async()=>{
  const { markets,warnings }=await liveMarkets(['BAD-TICKER'],fixture({badSeries:true}));
  assert.equal(markets.length,2); assert.equal(warnings.length,2);
  assert.ok(warnings.some(w=>w.includes('HTTP 404'))); assert.ok(warnings.some(w=>w.includes('HTTP 503')));
  assert.ok(markets.every(m=>!m.synthetic));
});
test('a rate-limited order book excludes only that market and explains the failure',async()=>{
  const {markets,warnings}=await liveMarkets([],fixture({badBook:true}));
  assert.equal(markets.length,2); assert.ok(warnings[0].includes('HTTP 429'));
});
test('total network failure remains an error with the connection cause',async()=>{
  await assert.rejects(()=>liveMarkets([],async()=>{throw new Error('fetch failed',{cause:{code:'ENOTFOUND'}});}),/ENOTFOUND/);
});
test('reachable API with no open contracts is distinguished from network failure',async()=>{
  const {markets,warnings}=await liveMarkets([],fixture({empty:true}));
  assert.equal(markets.length,0); assert.match(warnings[0],/No open contracts/);
});
