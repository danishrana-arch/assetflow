const http = require("http")
const https = require("https")

function httpGet(url, headers={}) {
  return new Promise((resolve,reject)=>{ const lib=url.startsWith("https")?https:http; const req=lib.get(url,{headers},r=>{let b="";r.on("data",c=>b+=c);r.on("end",()=>{try{resolve(JSON.parse(b))}catch{resolve(b)}})});req.on("error",reject);req.setTimeout(10000,()=>req.destroy(new Error("timeout"))) })
}

function createAdapter(config) {
  if (config.vendor === "HTTP" || config.connectionMode === "HTTP") return new HttpAdapter(config)
  if (config.vendor === "ZKTECO") return new ZktecoAdapter(config)
  return new UnsupportedAdapter(config)
}

class HttpAdapter {
  constructor(c){this.c=c}
  async pullPunches(){
    if (!this.c.ipAddress) throw new Error("HTTP device requires ipAddress or a custom adapter")
    const url=`http://${this.c.ipAddress}:${this.c.port || 80}/api/attendance`
    const data=await httpGet(url)
    const rows=Array.isArray(data)?data:(data.punches||data.data||[])
    return rows.map((p,i)=>({externalUserId:String(p.externalUserId||p.userId||p.uid),occurredAt:p.occurredAt||p.timestamp||p.datetime,verification:p.verification||"biometric",externalId:String(p.externalId||`${p.userId||p.uid}:${p.timestamp||p.datetime||i}`),rawPayload:p}))
  }
}

class ZktecoAdapter {
  constructor(c){this.c=c}
  async pullPunches(){
    let ZKLib
    try { ZKLib=require("node-zklib") } catch { throw new Error("ZKTeco adapter requires 'node-zklib' in connector. Run npm install node-zklib") }
    const zk=new ZKLib(this.c.ipAddress,this.c.port||4370,10000,4000,0,"tcp")
    try {
      await zk.createSocket()
      const logs=await zk.getAttendances()
      const rows=logs?.data || logs || []
      return rows.map((p,i)=>({externalUserId:String(p.user_id ?? p.userId ?? p.uid ?? p.userId),occurredAt:p.record_time||p.timestamp||p.datetime||p.time,verification:String(p.type ?? p.state ?? "biometric"),externalId:String(p.uid ?? p.id ?? `${p.user_id||p.userId}:${p.record_time||p.timestamp||i}`),rawPayload:p})).filter(p=>p.externalUserId && p.occurredAt)
    } finally { try{await zk.disconnect()}catch{} }
  }
}
class UnsupportedAdapter { constructor(c){this.c=c} async pullPunches(){throw new Error(`No built-in adapter for ${this.c.vendor}. Use PUSH/HTTP mode or install a vendor adapter.`)} }
module.exports={createAdapter}
