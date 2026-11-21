// Host-side read-only collector. The API receives only an atomic JSON snapshot.
import {execFileSync} from 'node:child_process'
import {writeFileSync,renameSync,mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
const [controlStack,targetStack,out]=process.argv.slice(2)
if(![controlStack,targetStack].every(x=>/^[a-z0-9][a-z0-9_-]+$/.test(x||''))||!out)throw Error('Explicit stacks and output required')
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:15000,maxBuffer:524288}).trim()
const service=controlStack+'_swarm-scale-controller'
const ids=docker('ps','--filter','label=com.docker.swarm.service.name='+service,'--format','{{.ID}}').split('\n').filter(Boolean)
if(ids.length!==1)throw Error('Controller not running; previous snapshot will expire')
const data=JSON.parse(docker('exec',ids[0],'node','-e',"const fs=require('fs');console.log(JSON.stringify({config:JSON.parse(fs.readFileSync('/run/config/controller.json')),state:JSON.parse(fs.readFileSync('/state/state.json'))}))"))
if(data.config.stack!==targetStack||data.config.service!=='canonical-normalizer')throw Error('Scope mismatch')
const enabled=docker('service','inspect',service,'--format','{{json .Spec.TaskTemplate.ContainerSpec.Env}}')
const image=docker('service','inspect',targetStack+'_canonical-normalizer','--format','{{.Spec.TaskTemplate.ContainerSpec.Image}}')
data.completion={scope:{stack:targetStack,service:'canonical-normalizer'},checkedAt:new Date().toISOString(),enabled:JSON.parse(enabled).includes('SWARM_CONTROLLER_APPLY=reviewed-live-autoscale'),running_replicas:ids.length,image_matches:image===data.config.image,recovery:{persistedStatus:data.state.recovery?.status}}
mkdirSync(dirname(out),{recursive:true});writeFileSync(out+'.tmp',JSON.stringify(data),{mode:0o644});renameSync(out+'.tmp',out)
