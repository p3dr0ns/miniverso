const SESSION_TTL=604800, LOGIN_WINDOW=900, LOGIN_LIMIT=8, MAX_BODY_BYTES=4096, COOKIE_NAME="miniverso_session", ITERATIONS=210000;
const enc=new TextEncoder();
class AuthError extends Error{constructor(status,code,message,retryAfter){super(message);Object.assign(this,{status,code,retryAfter})}}
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",Pragma:"no-cache","X-Content-Type-Options":"nosniff",...headers}})}
const invalid=(message="Confira os dados enviados e tente novamente.",status=400)=>new AuthError(status,"invalid_request",message);
const unavailable=()=>new AuthError(503,"auth_unavailable","O acesso está temporariamente indisponível. Tente novamente mais tarde.");
function emailOf(value){if(typeof value!=="string")throw invalid("Informe um e-mail válido.");const email=value.trim().toLowerCase();if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw invalid("Informe um e-mail válido.");return email}
function passwordOf(value){if(typeof value!=="string"||value.length<8||value.length>128)throw invalid("A senha deve ter entre 8 e 128 caracteres.");return value}
function configured(env){if(!env.AUTH_DB?.prepare||!env.AUTH_DB?.batch||typeof env.AUTH_SECRET!=="string"||env.AUTH_SECRET.trim().length<32)throw unavailable()}
async function readJson(request){
  if(request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw invalid("Envie os dados no formato JSON.",415);
  if(Number(request.headers.get("Content-Length")||0)>MAX_BODY_BYTES)throw invalid("A solicitação é grande demais.",413);
  if(!request.body)throw invalid();const reader=request.body.getReader(),chunks=[];let length=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BODY_BYTES){await reader.cancel();throw invalid("A solicitação é grande demais.",413)}chunks.push(value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  try{const body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(!body||typeof body!=="object"||Array.isArray(body))throw 0;return body}catch{throw invalid("Não foi possível ler os dados enviados.")}
}
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
const randomToken=(size=32)=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(size)))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
async function sha(value){return hex(await crypto.subtle.digest("SHA-256",enc.encode(value)))}
async function hmac(secret,value){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",key,enc.encode(value)))}
async function passwordHash(password,salt,secret){const key=await crypto.subtle.importKey("raw",enc.encode(password+"\0"+secret),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:enc.encode(salt),iterations:ITERATIONS},key,256))}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
const sessionCookie=(token,now)=>`${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}; Expires=${new Date((now+SESSION_TTL)*1000).toUTCString()}`;
const clearCookie=()=>`${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
function requestToken(request){const value=request.headers.get("Cookie")?.match(/(?:^|;\s*)miniverso_session=([^;]*)/)?.[1];return value&&/^[\w-]{43}$/.test(value)?value:null}
const publicSession=row=>row?{user:{id:row.user_id,email:row.email},expires_at:row.expires_at}:null;
async function createSession(db,userId,email){const token=randomToken(),tokenHash=await sha(token),now=Math.floor(Date.now()/1000);await db.batch([
  db.prepare("INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(tokenHash,userId,now,now+SESSION_TTL),
  db.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").bind(now),db.prepare("DELETE FROM auth_login_attempts WHERE created_at<=?").bind(now-LOGIN_WINDOW)
]);return json({session:{user:{id:userId,email},expires_at:now+SESSION_TTL}},200,{"Set-Cookie":sessionCookie(token,now)})}
async function register(request,env){const body=await readJson(request),email=emailOf(body.email),password=passwordOf(body.password),id=crypto.randomUUID(),salt=randomToken(16),hash=await passwordHash(password,salt,env.AUTH_SECRET),now=Math.floor(Date.now()/1000);
  try{await env.AUTH_DB.prepare("INSERT INTO auth_users(id,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?)").bind(id,email,hash,salt,now).run()}catch{throw new AuthError(409,"email_in_use","Já existe uma conta com este e-mail. Use a opção ‘Já tenho conta’.")}
  return createSession(env.AUTH_DB,id,email)}
async function login(request,env){const body=await readJson(request),email=emailOf(body.email),password=passwordOf(body.password),ip=await hmac(env.AUTH_SECRET,"ip\0"+(request.headers.get("CF-Connecting-IP")||"unknown")),now=Math.floor(Date.now()/1000);
  const attempts=await env.AUTH_DB.prepare("SELECT COUNT(*) total,MIN(created_at) first FROM auth_login_attempts WHERE (email=? OR ip_hash=?) AND created_at>?").bind(email,ip,now-LOGIN_WINDOW).first();
  if(attempts?.total>=LOGIN_LIMIT)throw new AuthError(429,"rate_limited","Muitas tentativas. Aguarde um pouco e tente novamente.",Math.max(1,attempts.first+LOGIN_WINDOW-now));
  const user=await env.AUTH_DB.prepare("SELECT id,email,password_hash,password_salt FROM auth_users WHERE email=?").bind(email).first(),candidate=await passwordHash(password,user?.password_salt||randomToken(16),env.AUTH_SECRET);
  if(!user||!equal(candidate,user.password_hash)){await env.AUTH_DB.prepare("INSERT INTO auth_login_attempts(id,email,ip_hash,created_at) VALUES(?,?,?,?)").bind(crypto.randomUUID(),email,ip,now).run();throw new AuthError(401,"invalid_credentials","E-mail ou senha incorretos.")}
  await env.AUTH_DB.prepare("DELETE FROM auth_login_attempts WHERE email=? OR ip_hash=?").bind(email,ip).run();return createSession(env.AUTH_DB,user.id,user.email)}
async function currentSession(request,env){const token=requestToken(request);if(!token)return json({session:null});const row=await env.AUTH_DB.prepare("SELECT s.user_id,u.email,s.expires_at FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>unixepoch('now')").bind(await sha(token)).first();return json({session:publicSession(row)})}
async function logout(request,env){await readJson(request);const token=requestToken(request);if(token)await env.AUTH_DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(await sha(token)).run();return json({ok:true},200,{"Set-Cookie":clearCookie()})}
export async function handleRequest(request,env){const url=new URL(request.url);if(url.pathname!=="/api"&&!url.pathname.startsWith("/api/"))return env.ASSETS?.fetch?env.ASSETS.fetch(request):new Response("Não encontrado.",{status:404});
  try{const routes={"/api/auth/register":"POST","/api/auth/login":"POST","/api/auth/session":"GET","/api/auth/logout":"POST"},method=routes[url.pathname];if(!method)throw new AuthError(404,"not_found","Endereço não encontrado.");if(request.method!==method)return json({code:"method_not_allowed",message:"Método não permitido."},405,{Allow:method});if(request.method==="POST"&&request.headers.get("Origin")!==url.origin)throw new AuthError(403,"origin_not_allowed","Esta solicitação não é permitida.");configured(env);if(url.pathname.endsWith("/register"))return await register(request,env);if(url.pathname.endsWith("/login"))return await login(request,env);if(url.pathname.endsWith("/session"))return await currentSession(request,env);return await logout(request,env)}
  catch(error){const failure=error instanceof AuthError?error:unavailable(),body={code:failure.code,message:failure.message},headers={};if(failure.retryAfter!=null){body.retryAfter=failure.retryAfter;headers["Retry-After"]=String(failure.retryAfter)}return json(body,failure.status,headers)}}
export default{fetch:handleRequest};
