// Fixed operator-configured monitoring target. Never accept a URL from the client.
export async function connectorReadiness(fetcher=fetch, target=process.env.DASHBOARD_CONNECTOR_READINESS_URL || 'http://source-connector:32100/readyz') {
  const checked_at=new Date().toISOString()
  try {
    const response=await fetcher(target,{signal:AbortSignal.timeout(3000),redirect:'error'})
    if(![200,503].includes(response.status))throw Error('unexpected_status')
    const data=await response.json()
    if(!['STARTING','CONNECTING','READY','DEGRADED','BLOCKED','STOPPED'].includes(data.status))throw Error('invalid_state')
    if((response.status===200)!==(data.status==='READY'))throw Error('inconsistent_state')
    const last_success_at=typeof data.last_success_at==='string'&&Number.isFinite(Date.parse(data.last_success_at))?new Date(data.last_success_at).toISOString():null
    return {checked_at,reachable:true,ready:response.status===200,status:data.status,last_success_at,
      error_present:!!data.error,scope:'configured_connector_process',lag_available:false}
  }catch{return {checked_at,reachable:false,ready:null,status:'UNVERIFIED',last_success_at:null,error_present:null,scope:'configured_connector_process',lag_available:false}}
}
