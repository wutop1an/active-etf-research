import assert from 'node:assert/strict';
import test from 'node:test';
import { counterKeys, trackingMode, parseCounter, CounterClient } from '../community.mjs';

test('项目统计不混用域名总量，入口统一，页面键不带查询及锚点', () => {
  const root = 'https://wutop1an.github.io/active-etf-research/';
  assert.deepEqual(counterKeys(root+'?utm_source=friend#main'), {project:root,page:root+'index.html'});
  assert.deepEqual(counterKeys(root+'581000.html?private=value#history'), {project:root,page:root+'581000.html'});
  assert.equal(counterKeys('https://wutop1an.github.io/another-project/'), null);
  assert.equal(counterKeys('http://127.0.0.1:8000/581000.html'), null);
  assert.equal(counterKeys(root+'../other/'), null);
  assert.deepEqual(parseCounter({success:true,data:{page_pv:7,page_uv:3,site_pv:999999,site_uv:88888}}), {views:7,visitors:3});
});

test('隐私关闭和本地预览不会变成计数模式，验收只读', () => {
  const href='https://wutop1an.github.io/active-etf-research/';
  assert.equal(trackingMode({href,disabled:true}),'disabled');
  assert.equal(trackingMode({href,doNotTrack:'1'}),'disabled');
  assert.equal(trackingMode({href,globalPrivacyControl:true}),'disabled');
  assert.equal(trackingMode({href:href+'?stats=read'}),'read');
  assert.equal(trackingMode({href:'file:///index.html'}),'local');
  assert.equal(trackingMode({href}),'count');
});

test('正常打开只增加一次；重复调用和刷新只读，不发送cookie或页面查询参数', async () => {
  const calls=[];
  const client=new CounterClient({fetcher:async (url,options)=>{
    calls.push(options);
    return {ok:true,headers:new Headers(),json:async()=>({success:true,data:{page_pv:1,page_uv:1}})};
  }});
  const keys=counterKeys('https://wutop1an.github.io/active-etf-research/581000.html');
  await client.countOnce(keys); await client.countOnce(keys); await client.read(keys);
  assert.deepEqual(calls.map(c=>c.method),['POST','POST','GET','GET','GET','GET']);
  assert.ok(calls.every(c=>c.credentials==='omit' && c.referrerPolicy==='no-referrer'));
  assert.equal(calls[0].headers['x-bsz-referer'],keys.project);
  assert.equal(calls[1].headers['x-bsz-referer'],keys.page);
});

test('计数失败不自动重发POST，故障和非法数据不伪装成0', async () => {
  const calls=[];
  const client=new CounterClient({fetcher:async (url,options)=>{calls.push(options.method);throw new Error('offline');}});
  const keys=counterKeys('https://wutop1an.github.io/active-etf-research/');
  assert.ok((await client.countOnce(keys)).every(r=>r.status==='rejected'));
  await client.countOnce(keys);
  assert.deepEqual(calls,['POST','POST','GET','GET']);
  for (const data of [{},{success:false,data:{page_pv:0,page_uv:0}},{success:true,data:{page_pv:-1,page_uv:1}},{success:true,data:{page_pv:'1',page_uv:1}}]) {
    assert.throws(()=>parseCounter(data));
  }
  assert.deepEqual(parseCounter({success:true,data:{page_pv:0,page_uv:0}}),{views:0,visitors:0});
});
