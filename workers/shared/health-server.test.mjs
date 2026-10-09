import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerHealth } from './health-server.mjs'

test('health server distinguishes lifecycle, liveness and runtime flag without details', async () => {
  let healthy = false, stopping = false
  const monitor = createWorkerHealth({ worker:'test-worker',runtime:{ isHealthy:()=>healthy },isStopping:()=>stopping,port:0,host:'127.0.0.1' })
  const port = await monitor.start()
  const get = (path='/readyz',method='GET') => fetch(`http://127.0.0.1:${port}${path}`,{method})
  try {
    assert.equal((await get()).status,503)
    assert.equal((await (await get()).json()).status,'STARTING')
    assert.equal((await get('/healthz')).status,200)
    monitor.markStarted(); healthy=true
    const ready=await get(); assert.equal(ready.status,200)
    assert.deepEqual(await ready.json(),{worker:'test-worker',status:'READY',ready:true,scope:'local_kafka_runtime_flag'})
    healthy=false; assert.equal((await (await get()).json()).status,'DEGRADED')
    assert.equal((await get('/healthz')).status,200)
    stopping=true; assert.equal((await (await get()).json()).status,'STOPPING')
    assert.equal((await get('/readyz?url=other')).status,404)
    assert.equal((await get('/readyz','POST')).status,404)
  } finally { await monitor.stop() }
})
test('health listener is opt-in and invalid ports fail explicitly',async()=>{
  const args={worker:'test',runtime:{isHealthy:()=>true},isStopping:()=>false}
  const disabled=createWorkerHealth({...args,port:''}); assert.equal(await disabled.start(),undefined); await disabled.stop()
  await assert.rejects(createWorkerHealth({...args,port:'invalid'}).start(),/invalid_worker_health_port/)
})
