/** Config checks remain dependency-free for local unit tests. */
export function validateConfig(env){
  if(env.NODE_ENV==='production'){
    if(!env.CORS_ORIGIN)throw new Error('Production CORS_ORIGIN must be explicit');
    const origins=env.CORS_ORIGIN.split(',').map(s=>s.trim());
    if(origins.some(o=>!o || o==='*' || !/^https:\/\/[^/\s]+$/.test(o)))
      throw new Error('Production CORS_ORIGIN must contain only explicit HTTPS origins');
    if(!env.JWT_SECRET || env.JWT_SECRET.length<48 || /^replace_with/i.test(env.JWT_SECRET))
      throw new Error('Set a unique, random production JWT_SECRET (48+ chars)');
  }
  return true;
}
