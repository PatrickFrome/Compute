import test from 'node:test';
import assert from 'node:assert/strict';
import {DevFleetOperator} from '../src/operator-core.mjs';
import {DevFleetConveyor} from '../src/conveyor-controller.mjs';

function fixture() {
  let saved=null;
  const store={
    load:async()=>saved===null?null:structuredClone(saved),
    save:async state=>{saved=structuredClone(state);}
  };
  const adapter={
    create:async(tab_id,url)=>({tab_id,url}),
    read:async()=>({text:''}),
    send:async()=>{throw Error('UNEXPECTED_PHYSICAL_SEND');}
  };
  return {store,adapter,inspect:()=>saved===null?null:structuredClone(saved)};
}
const create=async fixture=>{
  const operator=new DevFleetOperator(fixture);
  await operator.init();
  return operator;
};

test('owner START remains enabled after DevFleet restart; STOP persists across next restart',async()=>{
  const source=fixture();
  const first=await create(source);
  assert.equal(first.conveyorIntent(),false);
  const enabled=new DevFleetConveyor(first,{retryDelayMs:10});
  assert.equal((await enabled.start({hot_slots:3})).state,'STARTED');
  assert.equal(source.inspect().conveyor_enabled,true);
  await enabled.stop();

  // Re-enable to model a process ending while the owner has asked for a
  // continuous dispatch. No tab or physical Send is created in this fixture.
  const again=new DevFleetConveyor(first,{retryDelayMs:10});
  await again.start({hot_slots:3});
  const second=await create(source);
  assert.equal(second.conveyorIntent(),true);
  const resumed=new DevFleetConveyor(second,{retryDelayMs:10});
  assert.equal(resumed.status().enabled,true);
  resumed.resume();
  assert.equal((await resumed.stop()).state,'STOPPING');
  assert.equal(source.inspect().conveyor_enabled,false);

  const third=await create(source);
  assert.equal(third.conveyorIntent(),false);
  assert.equal(new DevFleetConveyor(third).status().enabled,false);
  await again.stop();
});

test('operator rejects malformed saved conveyor intent instead of silently starting',async()=>{
  const source=fixture();
  const first=await create(source);
  await first.setConveyorIntent({enabled:true});
  const state=source.inspect();
  state.conveyor_enabled='yes';
  const bad={
    store:{load:async()=>state,save:async()=>{}},
    adapter:source.adapter
  };
  await assert.rejects(create(bad),/operator_conveyor_intent_invalid/);
});
