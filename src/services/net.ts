/** True for hosts on the user's own network (LAN, link-local, loopback, mDNS). */
export function isPrivateComfyHost(hostname:string):boolean{
 const host=hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
 if(host==='localhost'||host.endsWith('.local')||host.endsWith('.lan')||host.endsWith('.home.arpa'))return true;
 if(host==='::1'||(host.includes(':')&&/^(fc|fd|fe80:)/.test(host)))return true;
 const parts=host.split('.');
 if(parts.length!==4||parts.some(part=>!/^\d{1,3}$/.test(part)||Number(part)>255))return false;
 const [a,b]=parts.map(Number);
 return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254);
}
